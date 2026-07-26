package com.abada.engine.core;

import com.abada.engine.core.model.EventMeta;
import com.abada.engine.observability.EngineMetrics;
import com.abada.engine.observability.TraceLogContext;
import com.abada.engine.persistence.entity.EventSubscriptionEntity;
import com.abada.engine.persistence.repository.EventSubscriptionRepository;
import io.micrometer.core.instrument.Timer;
import io.micrometer.tracing.annotation.SpanTag;
import io.opentelemetry.instrumentation.annotations.WithSpan;
import io.opentelemetry.api.trace.Span;
import io.opentelemetry.api.trace.Tracer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Map;
import java.time.Instant;

@Component
public class EventManager {

    private static final Logger log = LoggerFactory.getLogger(EventManager.class);

    private AbadaEngine abadaEngine;
    private final EngineMetrics engineMetrics;
    private final Tracer tracer;
    private final EventSubscriptionRepository subscriptionRepository;

    @Autowired
    public EventManager(EngineMetrics engineMetrics, Tracer tracer,
            EventSubscriptionRepository subscriptionRepository) {
        this.engineMetrics = engineMetrics;
        this.tracer = tracer;
        this.subscriptionRepository = subscriptionRepository;
    }

    public void setAbadaEngine(AbadaEngine abadaEngine) {
        this.abadaEngine = abadaEngine;
    }

    /**
     * Registers a process instance that is waiting for one or more events.
     */
    void registerWaitStates(ProcessInstance instance) {
        for (String tokenId : instance.getActiveTokens()) {
            if (instance.getDefinition().isCatchEvent(tokenId)) {
                EventMeta eventMeta = instance.getDefinition().getEvents().get(tokenId);
                if (eventMeta == null) continue;

                switch (eventMeta.type()) {
                    case MESSAGE -> registerMessageSubscription(instance, eventMeta);
                    case SIGNAL -> registerSignalSubscription(instance, eventMeta);
                    case CONDITIONAL -> log.debug("Conditional events not yet implemented for instance {}", instance.getId());
                    case TIMER -> log.debug("Timer events are handled by the JobScheduler, not here for instance {}", instance.getId());
                }
            }
        }
    }

    private void registerMessageSubscription(ProcessInstance instance, EventMeta eventMeta) {
        String correlationKey = (String) instance.getVariable("correlationKey");
        if (correlationKey == null) {
            log.warn("Instance {} is waiting for message '{}' but has no correlationKey variable.", instance.getId(), eventMeta.definitionRef());
            return;
        }
        persistSubscription(instance, eventMeta, EventSubscriptionEntity.Type.MESSAGE, correlationKey);
    }

    private void registerSignalSubscription(ProcessInstance instance, EventMeta eventMeta) {
        persistSubscription(instance, eventMeta, EventSubscriptionEntity.Type.SIGNAL, null);
    }

    private void persistSubscription(ProcessInstance instance, EventMeta eventMeta,
            EventSubscriptionEntity.Type type, String correlationKey) {
        if (subscriptionRepository.existsByProcessInstanceIdAndActivityId(instance.getId(), eventMeta.id())) return;
        EventSubscriptionEntity subscription = new EventSubscriptionEntity();
        subscription.setProcessInstanceId(instance.getId());
        subscription.setActivityId(eventMeta.id());
        subscription.setEventType(type);
        subscription.setEventName(eventMeta.definitionRef());
        subscription.setCorrelationKey(correlationKey);
        subscriptionRepository.save(subscription);
        log.info("Registered instance {} waiting for {} '{}'", instance.getId(), type, eventMeta.definitionRef());
    }

    @WithSpan("abada.event.correlate.message")
    @AtomicRuntimeCommand
    public void correlateMessage(@SpanTag("event.name") String messageName, 
                                @SpanTag("correlation.key") String correlationKey, 
                                Map<String, Object> variables) {
        Span span = tracer.spanBuilder("abada.event.correlate.message").startSpan();
        
        try (var scope = TraceLogContext.open(span)) {
            span.setAttribute("event.name", messageName);
            span.setAttribute("event.type", "MESSAGE");
            span.setAttribute("correlation.key", correlationKey);
            
            // Record event consumption
            engineMetrics.recordEventConsumed("MESSAGE", messageName);
            
            var subscription = subscriptionRepository
                    .findFirstByEventTypeAndEventNameAndCorrelationKeyAndConsumedAtIsNull(
                            EventSubscriptionEntity.Type.MESSAGE, messageName, correlationKey);
            if (subscription.isPresent()) {
                    EventSubscriptionEntity waiting = subscription.get();
                    waiting.setConsumedAt(Instant.now());
                    subscriptionRepository.save(waiting);
                    span.setAttribute("process.instance.id", waiting.getProcessInstanceId());
                    span.setAttribute("event.id", waiting.getActivityId());
                    
                    log.info("Correlated message '{}' with key '{}' to instance {}. Resuming...", messageName, correlationKey, waiting.getProcessInstanceId());
                    abadaEngine.resumeFromEvent(waiting.getProcessInstanceId(), waiting.getActivityId(), variables);
                    
                    engineMetrics.recordEventCorrelated("MESSAGE", messageName);
            } else {
                span.setAttribute("correlation.result", "no_matching_subscription");
            }
        } catch (Exception e) {
            span.recordException(e);
            span.setStatus(io.opentelemetry.api.trace.StatusCode.ERROR, e.getMessage());
            throw e;
        } finally {
            span.end();
        }
    }
	
    @WithSpan("abada.event.broadcast.signal")
    @AtomicRuntimeCommand
    public void broadcastSignal(@SpanTag("event.name") String signalName, Map<String, Object> variables) {
        Span span = tracer.spanBuilder("abada.event.broadcast.signal").startSpan();
        
        try (var scope = TraceLogContext.open(span)) {
            span.setAttribute("event.name", signalName);
            span.setAttribute("event.type", "SIGNAL");
            
            // Record event consumption
            engineMetrics.recordEventConsumed("SIGNAL", signalName);
            
            List<EventSubscriptionEntity> subs = subscriptionRepository
                    .findByEventTypeAndEventNameAndConsumedAtIsNullOrderByIdAsc(
                            EventSubscriptionEntity.Type.SIGNAL, signalName);
            if (subs != null && !subs.isEmpty()) {
                span.setAttribute("instances.count", subs.size());
                log.info("Broadcasting signal '{}' to {} waiting instances.", signalName, subs.size());
                for (EventSubscriptionEntity waiting : subs) {
                    waiting.setConsumedAt(Instant.now());
                    subscriptionRepository.save(waiting);
                    abadaEngine.resumeFromEvent(waiting.getProcessInstanceId(), waiting.getActivityId(), variables);
                    engineMetrics.recordEventCorrelated("SIGNAL", signalName);
                }
            } else {
                span.setAttribute("instances.count", 0);
                log.warn("Received signal '{}' but no instances were waiting.", signalName);
            }
        } catch (Exception e) {
            span.recordException(e);
            span.setStatus(io.opentelemetry.api.trace.StatusCode.ERROR, e.getMessage());
            throw e;
        } finally {
            span.end();
        }
    }

    /**
     * Publishes a message event to the engine.
     * This method should be called when an external system sends a message event.
     */
    @WithSpan("abada.event.publish.message")
    public void publishMessage(@SpanTag("event.name") String messageName, 
                              @SpanTag("correlation.key") String correlationKey, 
                              Map<String, Object> variables) {
        Span span = tracer.spanBuilder("abada.event.publish.message").startSpan();
        Timer.Sample processingSample = engineMetrics.startEventProcessingTimer();
        
        try (var scope = TraceLogContext.open(span)) {
            span.setAttribute("event.name", messageName);
            span.setAttribute("event.type", "MESSAGE");
            span.setAttribute("correlation.key", correlationKey);
            
            // Record event publication
            engineMetrics.recordEventPublished("MESSAGE", messageName);
            
            // Increment queue size
            engineMetrics.incrementEventQueueSize();
            
            log.info("Publishing message '{}' with correlation key '{}'", messageName, correlationKey);
            
            // Process the message correlation
            correlateMessage(messageName, correlationKey, variables);
            
            // Record processing latency
            engineMetrics.recordEventProcessingLatency(processingSample, "MESSAGE", messageName);
        } catch (Exception e) {
            span.recordException(e);
            span.setStatus(io.opentelemetry.api.trace.StatusCode.ERROR, e.getMessage());
            throw e;
        } finally {
            // Decrement queue size
            engineMetrics.decrementEventQueueSize();
            span.end();
        }
    }

    /**
     * Publishes a signal event to the engine.
     * This method should be called when an external system sends a signal event.
     */
    @WithSpan("abada.event.publish.signal")
    public void publishSignal(@SpanTag("event.name") String signalName, 
                             Map<String, Object> variables) {
        Span span = tracer.spanBuilder("abada.event.publish.signal").startSpan();
        Timer.Sample processingSample = engineMetrics.startEventProcessingTimer();
        
        try (var scope = TraceLogContext.open(span)) {
            span.setAttribute("event.name", signalName);
            span.setAttribute("event.type", "SIGNAL");
            
            // Record event publication
            engineMetrics.recordEventPublished("SIGNAL", signalName);
            
            // Increment queue size
            engineMetrics.incrementEventQueueSize();
            
            log.info("Publishing signal '{}'", signalName);
            
            // Process the signal broadcast
            broadcastSignal(signalName, variables);
            
            // Record processing latency
            engineMetrics.recordEventProcessingLatency(processingSample, "SIGNAL", signalName);
        } catch (Exception e) {
            span.recordException(e);
            span.setStatus(io.opentelemetry.api.trace.StatusCode.ERROR, e.getMessage());
            throw e;
        } finally {
            // Decrement queue size
            engineMetrics.decrementEventQueueSize();
            span.end();
        }
    }
}

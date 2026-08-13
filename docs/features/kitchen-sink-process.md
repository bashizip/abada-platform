# The "Kitchen Sink" Process

The `kitchen-sink-test.bpmn` process is a comprehensive workflow designed to validate all major features of the Abada Engine in a single, end-to-end integration test. It serves as a quality gate for the engine and a living example of how to combine different BPMN elements.

The same shape is authored natively as APL in `engine/src/test/resources/apl/kitchen-sink.apl.yaml` — the APL twin must stay 1:1 with this document (the embedded Java delegate maps to the language-agnostic `script` node). The legacy BPMN file and the APL twin are proven to agree by the [`AplKitchenSinkTest`](../../engine/src/test/java/com/abada/engine/core/AplKitchenSinkTest.java) (PostgreSQL) and the Studio APL↔BPMN round-trip check (`npm run verify:kitchen-sink` in `studio/`).

---

### Process Workflow

The process simulates a complex order fulfillment scenario that involves parallel execution, event-based decisions, conditional paths, and both embedded and external service tasks.

#### 1. Initialization
*   **Start Event**: The process begins.
*   **User Task (`Set Variables`)**: The process immediately pauses at a user task. This is the crucial first step that allows a user or test to provide initial variables, such as a `correlationKey` for message events and a `path` variable for later conditional routing.

#### 2. Parallel Fork
*   **Parallel Gateway (`ParallelFork`)**: After the initial task is completed, the process splits into two concurrent paths of execution (Path A and Path B).

#### 3. Path A: Synchronous Logic
*   **Service Task (`Embedded Delegate`)**: This path immediately executes an embedded `JavaDelegate` class (`com.abada.engine.delegates.TestDelegate`). This is a synchronous operation that modifies the process variables directly and then completes, allowing Path A to proceed.

#### 4. Path B: Asynchronous Waiting
*   **Event-Based Gateway**: This path immediately reaches an event-based gateway, which pauses this branch of the process.
*   **Wait States**: The gateway presents two possibilities:
    *   **Message Catch Event**: The process can be resumed if a message named `FastTrackMessage` is correlated with the correct `correlationKey`.
    *   **Timer Catch Event**: The process will automatically resume after a configured duration (e.g., 1 hour) if no message is received.

#### 5. Parallel Join
*   **Parallel Gateway (`ParallelJoin`)**: This gateway acts as a synchronization point. It will wait until **both** Path A and Path B have completed their work. The process will only continue once the embedded service task is done AND the message/timer event has been triggered.

#### 6. Conditional Path (Inclusive Gateway)
*   **Inclusive Gateway (`InclusiveFork`)**: After the parallel paths have joined, the process reaches an inclusive gateway. It evaluates the `path` variable that was set in the initial step.
*   **Routing**: 
    *   If `path == 'C'`, it proceeds to `Task C`.
    *   If `path == 'D'`, it proceeds to `Task D`.
*   **Inclusive Join**: Both paths from the inclusive gateway lead to another inclusive join, which waits for the active path to complete before moving on.

#### 7. External Automation
*   **Service Task (`Final External Step`)**: Before ending, the process reaches a service task configured with a `topic` (`kitchen-sink-topic`).
*   **External Task Job**: The engine pauses and creates a job in the database for an external worker. The process will only resume once a worker fetches, locks, and completes this job via the REST API.

#### 8. Completion
*   **End Event**: Once the external task is completed, the process flows to the end event and is marked as complete.

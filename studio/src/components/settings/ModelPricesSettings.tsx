import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Pencil, Plus, RefreshCw, Search, Trash2 } from 'lucide-react';
import { EffectivePrice, EvidenceAPI, ModelPrice, PriceCatalogStatus } from '@/api/evidence';
import { AiProvidersAPI } from '@/api/aiProviders';
import { getDefaultAgentModel } from '@/lib/agentModels';
import { useAiProvidersVersion } from '@/lib/aiProviderEvents';

const inputClass = 'mt-1 w-full rounded-lg border border-hairline bg-charcoal-deep px-2.5 py-2 text-xs text-linen placeholder-stone focus:border-mineral-teal focus:outline-none focus:ring-1 focus:ring-mineral-teal/30';
const MAX_ROWS = 40;

const hostOf = (url: string): string => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

const money = (value: number | null) => (value === null ? '—' : `$${value}`);

const ago = (iso: string | null): string => {
  if (!iso) return 'never';
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours} h ago` : `${Math.round(hours / 24)} days ago`;
};

/** Where a price comes from, in plain words. */
const SourceChip: React.FC<{ price: EffectivePrice }> = ({ price }) => {
  if (price.source === 'ADMIN') {
    return <span className="rounded-full border border-sage-green/40 bg-sage-green/10 px-2 py-0.5 text-[10px] text-sage-green">Your price</span>;
  }
  if (price.source === 'CATALOG') {
    const snapshot = price.catalogSource?.startsWith('snapshot');
    return (
      <span className="rounded-full border border-mineral-teal/40 bg-mineral-teal/10 px-2 py-0.5 text-[10px] text-mineral-teal"
        title={`${price.catalogModel ?? ''} · ${price.catalogSource ?? ''}`}>
        {snapshot ? 'Release snapshot' : 'Public catalog'}
      </span>
    );
  }
  return <span className="rounded-full border border-saffron/40 bg-saffron/10 px-2 py-0.5 text-[10px] text-saffron">Unpriced</span>;
};

/**
 * Model prices the engine computes agent cost with (USD per million tokens).
 * Your prices win; without one, the price comes from the public model catalog
 * the engine reads once a day (or the snapshot shipped with the release), so a
 * call is only "unpriced" when no source knows the model. Prices are
 * effective-dated: a change is a new price from a date, so costs already
 * computed never move. Only a price that has not taken effect can be removed.
 */
export const ModelPricesSettings: React.FC<{ onError: (message: string | null) => void }> = ({ onError }) => {
  const [prices, setPrices] = useState<ModelPrice[] | null>(null);
  const [inUse, setInUse] = useState<string[]>([]);
  const [effective, setEffective] = useState<EffectivePrice[] | null>(null);
  const [catalog, setCatalog] = useState<PriceCatalogStatus | null>(null);
  const [query, setQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [model, setModel] = useState('');
  const [provider, setProvider] = useState('');
  const [input, setInput] = useState('');
  const [output, setOutput] = useState('');
  const [from, setFrom] = useState('');
  const [busy, setBusy] = useState(false);
  const providersVersion = useAiProvidersVersion();

  const load = useCallback(async () => {
    try {
      setPrices(await EvidenceAPI.prices());
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause));
      setPrices([]);
    }
  }, [onError]);

  // The models worth showing: the default model and what the configured providers list.
  const loadInUse = useCallback(async () => {
    const models = new Set<string>([getDefaultAgentModel()]);
    try {
      (await AiProvidersAPI.models()).forEach((provider) => provider.models.forEach((item) => models.add(item)));
    } catch {
      // Without provider lists, the default model and searches still work.
    }
    setInUse([...models].sort());
    try {
      setCatalog(await EvidenceAPI.priceCatalog());
    } catch {
      setCatalog(null);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { void loadInUse(); }, [loadInUse, providersVersion]);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matching = needle ? inUse.filter((item) => item.toLowerCase().includes(needle)) : inUse;
    const rows = matching.slice(0, MAX_ROWS);
    // A model nobody lists can still be looked up by its exact id.
    if (needle && !rows.some((item) => item.toLowerCase() === needle)) rows.unshift(query.trim());
    return rows;
  }, [inUse, query]);

  useEffect(() => {
    if (shown.length === 0) {
      setEffective([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      EvidenceAPI.effectivePrices(shown)
        .then((rows) => { if (!cancelled) setEffective(rows); })
        .catch(() => { if (!cancelled) setEffective([]); });
    }, 200);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [shown, prices]);

  const refreshCatalog = async () => {
    setRefreshing(true);
    onError(null);
    try {
      setCatalog(await EvidenceAPI.refreshPriceCatalog());
      setPrices(await EvidenceAPI.prices());
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setRefreshing(false);
    }
  };

  const override = (price: EffectivePrice) => {
    setModel(price.model);
    setInput(price.inputPerMillion === null ? '' : String(price.inputPerMillion));
    setOutput(price.outputPerMillion === null ? '' : String(price.outputPerMillion));
  };

  const valid = model.trim() !== '' && input.trim() !== '' && output.trim() !== ''
    && Number(input) >= 0 && Number(output) >= 0;

  const add = async () => {
    setBusy(true);
    onError(null);
    try {
      await EvidenceAPI.addPrice({
        model: model.trim(),
        provider: provider.trim() || undefined,
        inputPerMillion: Number(input),
        outputPerMillion: Number(output),
        effectiveFrom: from ? new Date(from).toISOString() : undefined,
      });
      setModel(''); setProvider(''); setInput(''); setOutput(''); setFrom('');
      await load();
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (price: ModelPrice) => {
    setBusy(true);
    onError(null);
    try {
      await EvidenceAPI.deletePrice(price.id);
      await load();
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const now = Date.now();
  return (
    <div className="space-y-4">
      <p className="text-[11px] leading-relaxed text-sand">
        The engine prices every agent call from its token counts with the price in effect at the time of the call.
        Your price wins; otherwise the price comes from the public model catalog. A model no source knows is
        shown as <span className="text-saffron">unpriced</span>, never as free.
      </p>

      {/* Prices in effect */}
      <section className="space-y-2 rounded-lg border border-hairline bg-charcoal p-3">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-[10px] font-medium uppercase tracking-wider text-sand">Prices in effect</h3>
          {catalog && (
            <span className="text-[10px] text-stone" title={catalog.message ?? undefined}>
              {catalog.enabled
                ? `Catalog ${hostOf(catalog.url)}: ${catalog.status === 'FAILED' ? 'last refresh failed, ' : ''}`
                  + `${catalog.modelCount ?? '—'} models, refreshed ${ago(catalog.refreshedAt)}`
                : `Catalog off: release snapshot of ${catalog.snapshotTaken.slice(0, 10)}`}
            </span>
          )}
          {catalog?.enabled && (
            <button type="button" onClick={() => void refreshCatalog()} disabled={refreshing} aria-label="Refresh price catalog"
              className="ml-auto flex items-center gap-1 rounded-md border border-hairline px-2 py-1 text-[10px] text-sand hover:text-linen disabled:opacity-50">
              {refreshing ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />} Refresh
            </button>
          )}
        </div>
        <label className="relative block">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-stone" />
          <input aria-label="Find a model" value={query} onChange={(event) => setQuery(event.target.value)}
            placeholder="Find a model, or type any model id" className={`${inputClass} mt-0 pl-8 font-mono`} />
        </label>
        {effective === null ? (
          <div className="flex items-center gap-2 text-xs text-sand"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading prices…</div>
        ) : (
          <table className="w-full text-left text-[11px]" aria-label="Prices in effect">
            <thead className="text-[10px] uppercase tracking-wider text-sand">
              <tr><th className="py-1">Model</th><th>Input / 1M</th><th>Output / 1M</th><th>Source</th><th /></tr>
            </thead>
            <tbody>
              {effective.map((price) => (
                <tr key={price.model} className="border-t border-hairline text-linen">
                  <td className="max-w-[16rem] truncate py-1.5 font-mono" title={price.model}>{price.model}</td>
                  <td className="font-mono">{money(price.inputPerMillion)}</td>
                  <td className="font-mono">{money(price.outputPerMillion)}</td>
                  <td><SourceChip price={price} /></td>
                  <td className="text-right">
                    <button type="button" aria-label={`Set your price for ${price.model}`} onClick={() => override(price)}
                      className="p-1 text-sand hover:text-mineral-teal"><Pencil className="h-3.5 w-3.5" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Your prices */}
      <div className="grid grid-cols-2 gap-3 rounded-lg border border-hairline bg-charcoal p-3 md:grid-cols-5">
        <label className="text-[10px] text-sand">Model
          <input aria-label="Model" className={inputClass} value={model} onChange={(event) => setModel(event.target.value)} placeholder="gemini-3.6-flash" />
        </label>
        <label className="text-[10px] text-sand">Provider (optional)
          <input aria-label="Provider" className={inputClass} value={provider} onChange={(event) => setProvider(event.target.value)} placeholder="any" />
        </label>
        <label className="text-[10px] text-sand">Input $ / 1M tokens
          <input aria-label="Input price" className={inputClass} type="number" min="0" step="0.0001" value={input} onChange={(event) => setInput(event.target.value)} />
        </label>
        <label className="text-[10px] text-sand">Output $ / 1M tokens
          <input aria-label="Output price" className={inputClass} type="number" min="0" step="0.0001" value={output} onChange={(event) => setOutput(event.target.value)} />
        </label>
        <label className="text-[10px] text-sand">Effective from (optional)
          <input aria-label="Effective from" className={inputClass} type="datetime-local" value={from} onChange={(event) => setFrom(event.target.value)} />
        </label>
        <div className="col-span-2 flex justify-end md:col-span-5">
          <button type="button" disabled={!valid || busy} onClick={() => void add()}
            className="flex items-center gap-1 rounded-md border border-mineral-teal/40 bg-mineral-teal/10 px-3 py-1.5 text-[11px] font-semibold text-mineral-teal hover:bg-mineral-teal/20 disabled:opacity-50">
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />} Add price
          </button>
        </div>
      </div>

      {prices === null ? (
        <div className="flex items-center gap-2 text-xs text-sand"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading prices…</div>
      ) : prices.length === 0 ? (
        <p className="text-xs text-sand">No prices of your own: catalog prices apply.</p>
      ) : (
        <table className="w-full text-left text-[11px]" aria-label="Model prices">
          <thead className="text-[10px] uppercase tracking-wider text-sand">
            <tr><th className="py-1">Your prices</th><th>Provider</th><th>Input / 1M</th><th>Output / 1M</th><th>Effective from</th><th /></tr>
          </thead>
          <tbody>
            {prices.map((price) => {
              const future = new Date(price.effectiveFrom).getTime() > now;
              return (
                <tr key={price.id} className="border-t border-hairline text-linen">
                  <td className="py-1.5 font-mono">{price.model}</td>
                  <td>{price.provider ?? 'any'}</td>
                  <td className="font-mono">${price.inputPerMillion}</td>
                  <td className="font-mono">${price.outputPerMillion}</td>
                  <td className="font-mono">{new Date(price.effectiveFrom).toLocaleString()}{future ? ' (scheduled)' : ''}</td>
                  <td className="text-right">
                    {future && (
                      <button type="button" aria-label={`Remove scheduled price for ${price.model}`} disabled={busy}
                        onClick={() => void remove(price)} className="p-1 text-sand hover:text-desert-rose">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
};

import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { EvidenceAPI, ModelPrice } from '@/api/evidence';

const inputClass = 'mt-1 w-full rounded-lg border border-[#3A322E] bg-[#14110D] px-2.5 py-2 text-xs text-[#EAE3D9] placeholder-[#5A524A] focus:border-[#2A9D8F] focus:outline-none focus:ring-1 focus:ring-[#2A9D8F]/30';

/**
 * Model prices the engine computes agent cost with (USD per million tokens).
 * Prices are effective-dated: a change is a new price from a date, so costs
 * already computed never move. Only a price that has not taken effect can be
 * removed.
 */
export const ModelPricesSettings: React.FC<{ onError: (message: string | null) => void }> = ({ onError }) => {
  const [prices, setPrices] = useState<ModelPrice[] | null>(null);
  const [model, setModel] = useState('');
  const [provider, setProvider] = useState('');
  const [input, setInput] = useState('');
  const [output, setOutput] = useState('');
  const [from, setFrom] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setPrices(await EvidenceAPI.prices());
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause));
      setPrices([]);
    }
  }, [onError]);

  useEffect(() => { void load(); }, [load]);

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
      <p className="text-[11px] leading-relaxed text-[#A89F91]">
        The engine prices every agent call from its token counts with the price in effect at the time of the call.
        A model without a price is shown as <span className="text-[#F4A261]">unpriced</span>, never as free.
      </p>

      <div className="grid grid-cols-2 gap-3 rounded-lg border border-[#3A322E] bg-[#1A1614] p-3 md:grid-cols-5">
        <label className="text-[10px] text-[#A89F91]">Model
          <input aria-label="Model" className={inputClass} value={model} onChange={(event) => setModel(event.target.value)} placeholder="gemini-3.6-flash" />
        </label>
        <label className="text-[10px] text-[#A89F91]">Provider (optional)
          <input aria-label="Provider" className={inputClass} value={provider} onChange={(event) => setProvider(event.target.value)} placeholder="any" />
        </label>
        <label className="text-[10px] text-[#A89F91]">Input $ / 1M tokens
          <input aria-label="Input price" className={inputClass} type="number" min="0" step="0.0001" value={input} onChange={(event) => setInput(event.target.value)} />
        </label>
        <label className="text-[10px] text-[#A89F91]">Output $ / 1M tokens
          <input aria-label="Output price" className={inputClass} type="number" min="0" step="0.0001" value={output} onChange={(event) => setOutput(event.target.value)} />
        </label>
        <label className="text-[10px] text-[#A89F91]">Effective from (optional)
          <input aria-label="Effective from" className={inputClass} type="datetime-local" value={from} onChange={(event) => setFrom(event.target.value)} />
        </label>
        <div className="col-span-2 flex justify-end md:col-span-5">
          <button type="button" disabled={!valid || busy} onClick={() => void add()}
            className="flex items-center gap-1 rounded-md border border-[#2A9D8F]/40 bg-[#2A9D8F]/10 px-3 py-1.5 text-[11px] font-semibold text-[#2A9D8F] hover:bg-[#2A9D8F]/20 disabled:opacity-50">
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />} Add price
          </button>
        </div>
      </div>

      {prices === null ? (
        <div className="flex items-center gap-2 text-xs text-[#A89F91]"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading prices…</div>
      ) : prices.length === 0 ? (
        <p className="text-xs text-[#A89F91]">No prices yet: every agent call is unpriced.</p>
      ) : (
        <table className="w-full text-left text-[11px]" aria-label="Model prices">
          <thead className="text-[10px] uppercase tracking-wider text-[#A89F91]">
            <tr><th className="py-1">Model</th><th>Provider</th><th>Input / 1M</th><th>Output / 1M</th><th>Effective from</th><th /></tr>
          </thead>
          <tbody>
            {prices.map((price) => {
              const future = new Date(price.effectiveFrom).getTime() > now;
              return (
                <tr key={price.id} className="border-t border-[#3A322E] text-[#EAE3D9]">
                  <td className="py-1.5 font-mono">{price.model}</td>
                  <td>{price.provider ?? 'any'}</td>
                  <td className="font-mono">${price.inputPerMillion}</td>
                  <td className="font-mono">${price.outputPerMillion}</td>
                  <td className="font-mono">{new Date(price.effectiveFrom).toLocaleString()}{future ? ' (scheduled)' : ''}</td>
                  <td className="text-right">
                    {future && (
                      <button type="button" aria-label={`Remove scheduled price for ${price.model}`} disabled={busy}
                        onClick={() => void remove(price)} className="p-1 text-[#A89F91] hover:text-[#E76F51]">
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

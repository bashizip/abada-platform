import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import * as Tooltip from '@radix-ui/react-tooltip';

export const TooltipProvider = Tooltip.Provider;

/**
 * Accessible hover tooltip. `side`/`sideOffset` control placement; content is
 * descriptive text shown on hover/focus (keyboard users reach it via focus).
 */
export const UITooltip: React.FC<{
  content: React.ReactNode;
  side?: 'top' | 'right' | 'bottom' | 'left';
  sideOffset?: number;
  children: React.ReactNode;
}> = ({ content, side = 'top', sideOffset = 8, children }) => (
  <Tooltip.Root>
    <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
    <Tooltip.Portal>
      <Tooltip.Content
        side={side}
        sideOffset={sideOffset}
        className="z-[100] select-none rounded-md border border-[#3A322E] bg-[#1A1614] px-2.5 py-1.5 text-[11px] leading-snug text-[#EAE3D9] shadow-warm-lg max-w-[280px]"
      >
        {content}
        <Tooltip.Arrow className="fill-[#1A1614]" />
      </Tooltip.Content>
    </Tooltip.Portal>
  </Tooltip.Root>
);

interface IconButtonProps {
  icon: React.ReactNode;
  label: string;
  tooltip: React.ReactNode;
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
  danger?: boolean;
  className?: string;
}

/**
 * Icon-only secondary control. Text is strictly reserved for primary CTAs;
 * every icon gets a hover tooltip carrying the contextual detail.
 */
export const IconButton: React.FC<IconButtonProps> = ({
  icon,
  label,
  tooltip,
  onClick,
  active = false,
  disabled = false,
  danger = false,
  className = '',
}) => (
  <UITooltip content={tooltip}>
    <button
      type="button"
      aria-label={label}
      title=""
      onClick={onClick}
      disabled={disabled}
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border transition-all ${
        active
          ? 'border-[#9D4EDD]/50 bg-[#9D4EDD]/20 text-[#EAE3D9]'
          : danger
            ? 'border-[#E76F51]/40 text-[#E76F51] hover:bg-[#2F2926]'
            : 'border-[#3A322E] bg-[#1A1614] text-[#A89F91] hover:text-[#EAE3D9] hover:bg-[#2F2926]'
      } ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'} ${className}`}
    >
      {icon}
    </button>
  </UITooltip>
);

/**
 * Modal dialog with the Studio look: dimmed backdrop, Escape and backdrop
 * click close it, and focus moves to the close button when it opens.
 */
export const Dialog: React.FC<{
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  icon?: React.ReactNode;
  size?: 'md' | 'lg';
  footer?: React.ReactNode;
  children: React.ReactNode;
}> = ({ open, onClose, title, subtitle, icon, size = 'md', footer, children }) => {
  const closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    closeButton.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : undefined}
        onClick={(event) => event.stopPropagation()}
        className={`flex max-h-[85vh] w-full flex-col overflow-hidden rounded-2xl border border-[#3A322E] bg-[#25201D] shadow-warm-xl ${size === 'lg' ? 'max-w-3xl' : 'max-w-md'}`}
      >
        <div className="flex items-start gap-3 border-b border-[#3A322E] px-5 py-4">
          {icon && <span className="mt-0.5 shrink-0">{icon}</span>}
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold text-[#EAE3D9]">{title}</h2>
            {subtitle && <p className="mt-0.5 text-[11px] text-[#A89F91]">{subtitle}</p>}
          </div>
          <button ref={closeButton} type="button" onClick={onClose} aria-label="Close"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-[#3A322E] text-[#A89F91] hover:bg-[#2F2926] hover:text-[#EAE3D9]">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-[#3A322E] px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
};

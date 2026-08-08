import React from 'react';
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
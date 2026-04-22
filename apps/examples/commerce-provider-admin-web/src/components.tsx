import * as Dialog from '@radix-ui/react-dialog';
import { LoaderCircle, X } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import type { PropsWithChildren, ReactNode } from 'react';
import { cn } from './lib/cn';

export function Button({
  className,
  busy,
  tone = 'default',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { busy?: boolean; tone?: 'default' | 'accent' | 'secondary' | 'danger' | 'outline' }) {
  return (
    <motion.button
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      {...props as any}
      className={cn(
        'group relative inline-flex h-11 items-center justify-center gap-2 overflow-hidden rounded-md px-5 text-sm font-semibold tracking-wide transition-all focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-ink/20 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100',
        tone === 'default' && 'bg-ink text-paper hover:bg-black shadow-[0_4px_14px_rgba(0,0,0,0.15)] hover:shadow-[0_6px_20px_rgba(0,0,0,0.2)]',
        tone === 'accent' && 'bg-spruce text-white shadow-spruce/20 hover:bg-spruce/90 hover:shadow-spruce/30',
        tone === 'secondary' && 'bg-fog/30 text-ink hover:bg-fog/50',
        tone === 'outline' && 'border border-ink/20 bg-transparent text-ink hover:border-ink/40 hover:bg-ink/5',
        tone === 'danger' && 'bg-ember text-white shadow-ember/20 hover:bg-ember/90',
        className,
      )}
    >
      <span className="relative z-10 flex items-center justify-center gap-2">
        {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
        {props.children}
      </span>
    </motion.button>
  );
}

export function Panel({ className, children, delay = 0 }: PropsWithChildren<{ className?: string; delay?: number }>) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay, ease: [0.21, 0.47, 0.32, 0.98] }}
      className={cn('relative overflow-hidden rounded-xl border border-ink/5 bg-white/70 shadow-[0_20px_60px_-15px_rgba(0,0,0,0.05)] backdrop-blur-xl', className)}
    >
      {/* Glossy inner setup */}
      <div className="pointer-events-none absolute inset-0 rounded-xl ring-1 ring-inset ring-white/50" />
      {children}
    </motion.section>
  );
}

export function Label({ className, children }: PropsWithChildren<{ className?: string }>) {
  return (
    <label className={cn('block text-xs font-semibold uppercase tracking-[0.2em] text-ink/40', className)}>
      {children}
    </label>
  );
}

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="relative">
      <input
        {...props}
        className={cn(
          'peer h-12 w-full rounded-lg border border-ink/10 bg-white/50 px-4 text-sm tracking-wide text-ink outline-none transition-all placeholder:text-ink/30 hover:bg-white focus:border-ink/30 focus:bg-white focus:shadow-[0_4px_24px_-4px_rgba(0,0,0,0.05)]',
          props.className,
        )}
      />
    </div>
  );
}

export function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={cn(
        'min-h-[140px] w-full resize-y rounded-lg border border-ink/10 bg-white/50 p-4 text-sm tracking-wide text-ink outline-none transition-all placeholder:text-ink/30 hover:bg-white focus:border-ink/30 focus:bg-white focus:shadow-[0_4px_24px_-4px_rgba(0,0,0,0.05)]',
        props.className,
      )}
    />
  );
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={cn(
        'h-12 w-full appearance-none rounded-lg border border-ink/10 bg-white/50 px-4 pr-10 text-sm tracking-wide text-ink outline-none transition-all hover:bg-white focus:border-ink/30 focus:bg-white focus:shadow-[0_4px_24px_-4px_rgba(0,0,0,0.05)]',
        props.className,
      )}
    />
  );
}

export function Badge({ children, tone = 'neutral' }: PropsWithChildren<{ tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'brand' }>) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-[0.2em] shadow-sm transition-colors',
        tone === 'neutral' && 'border-ink/5 bg-ink/5 text-ink/70',
        tone === 'success' && 'border-spruce/10 bg-spruce/5 text-spruce',
        tone === 'warning' && 'border-brass/10 bg-brass/5 text-brass',
        tone === 'brand' && 'border-indigo-500/10 bg-indigo-500/5 text-indigo-600',
        tone === 'danger' && 'border-ember/10 bg-ember/5 text-ember',
      )}
    >
      {children}
    </span>
  );
}

export function Metric({
  label,
  value,
  note,
  delay = 0,
}: {
  label: string;
  value: ReactNode;
  note?: string;
  delay?: number;
}) {
  return (
    <motion.div 
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.5, delay, ease: "easeOut" }}
      className="group relative flex min-h-[140px] flex-col justify-between overflow-hidden rounded-xl border border-ink/5 bg-gradient-to-br from-white/90 to-white/40 p-6 shadow-sm transition-all hover:shadow-md hover:border-ink/10"
    >
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-ink/[0.03] via-transparent to-transparent opacity-0 transition-opacity duration-500 group-hover:opacity-100" />
      <span className="relative z-10 text-xs font-semibold uppercase tracking-[0.2em] text-ink/40">{label}</span>
      <div className="relative z-10 space-y-2 mt-4">
        <div className="font-display text-5xl tracking-tight text-ink drop-shadow-sm">{value}</div>
        {note ? <p className="text-sm font-medium tracking-wide text-ink/40">{note}</p> : null}
      </div>
    </motion.div>
  );
}

export function Modal({
  open,
  title,
  description,
  onOpenChange,
  children,
}: PropsWithChildren<{
  open: boolean;
  title: string;
  description: ReactNode;
  onOpenChange: (open: boolean) => void;
}>) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild>
              <motion.div
                initial={{ opacity: 0, backdropFilter: 'blur(0px)' }}
                animate={{ opacity: 1, backdropFilter: 'blur(12px)' }}
                exit={{ opacity: 0, backdropFilter: 'blur(0px)' }}
                transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
                className="fixed inset-0 z-40 bg-paper/60"
              />
            </Dialog.Overlay>
            <Dialog.Content asChild>
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: '40%', x: '-50%' }}
                animate={{ opacity: 1, scale: 1, y: '-50%', x: '-50%' }}
                exit={{ opacity: 0, scale: 0.95, y: '40%', x: '-50%' }}
                transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                className="fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[min(92vw,740px)] overflow-y-auto rounded-2xl border border-ink/10 bg-white/95 p-8 shadow-[0_30px_100px_-20px_rgba(0,0,0,0.15)] ring-1 ring-inset ring-white/50 backdrop-blur-2xl outline-none"
              >
                <div className="mb-8 flex items-start justify-between gap-6">
                  <div className="space-y-3">
                    <Dialog.Title className="font-display text-4xl leading-none tracking-tight text-ink">{title}</Dialog.Title>
                    <Dialog.Description className="max-w-[46ch] text-sm font-medium tracking-wide text-ink/50">{description}</Dialog.Description>
                  </div>
                  <Dialog.Close asChild>
                    <button className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-ink/10 bg-white shadow-sm transition hover:border-ink/30 hover:bg-ink/5 hover:text-ink">
                      <X className="h-4 w-4" />
                    </button>
                  </Dialog.Close>
                </div>
                {children}
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}

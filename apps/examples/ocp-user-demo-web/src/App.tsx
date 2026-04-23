import { Bot, Compass, ExternalLink, MemoryStick, Route, Sparkles, Trash2, ArrowRight, LoaderCircle } from 'lucide-react';
import { Fragment, useEffect, useState, useRef, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  agentTurn,
  confirmCatalogRegistration,
  resolveEntry,
  type CatalogQueryItem,
  type CatalogSearchItem,
  type QuerySession,
  type ResolvableReference,
  type SavedCatalogProfile,
} from './api';
import { Badge, Button, Label, Modal } from './components';
import { cn } from './lib/cn';

const resultImages = [
  'https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1512436991641-6745cdb1723f?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1549298916-b41d501d3772?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1618366712010-f4ae9c647dcb?auto=format&fit=crop&w=1200&q=80'
];

const localProfilesStorageKey = 'ocp-user-demo.catalog-profiles.v2';

type ToastState = { tone: 'success' | 'danger'; message: string } | null;

type AgentMessage = {
  id: string;
  role: 'user' | 'agent';
  content: string;
};

export function App() {
  const [draftMessage, setDraftMessage] = useState('');
  const [savedProfiles, setSavedProfiles] = useState<SavedCatalogProfile[]>(() => readSavedProfiles());
  const [pendingCatalog, setPendingCatalog] = useState<CatalogSearchItem | null>(null);
  const [activeProfile, setActiveProfile] = useState<SavedCatalogProfile | null>(null);
  const [catalogResults, setCatalogResults] = useState<CatalogQueryItem[]>([]);
  const [resolvedItem, setResolvedItem] = useState<ResolvableReference | null>(null);
  const [agentMessages, setAgentMessages] = useState<AgentMessage[]>([
    {
      id: crypto.randomUUID(),
      role: 'agent',
      content: '告诉我你想找什么。我会先检查本地 catalog profile。默认不会自动注册新的 catalog，只有在你明确同意后，我才会把它保存到本地并继续检索。',
    },
  ]);
  const [querySession, setQuerySession] = useState<QuerySession | null>(null);
  const [toast, setToast] = useState<ToastState>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [resolveOpen, setResolveOpen] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    writeSavedProfiles(savedProfiles);
  }, [savedProfiles]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [agentMessages]);

  const selectedTopAction = resolvedItem?.action_bindings[0] ?? null;

  async function withAction(actionKey: string, fn: () => Promise<void>, onError?: (error: unknown) => void) {
    try {
      setBusyAction(actionKey);
      await fn();
    } catch (error) {
      onError?.(error);
      setToast({
        tone: 'danger',
        message: error instanceof Error ? error.message : 'Unexpected error',
      });
    } finally {
      setBusyAction(null);
    }
  }

  function pushMessage(role: AgentMessage['role'], content: string) {
    setAgentMessages((current) => [...current, { id: crypto.randomUUID(), role, content }]);
  }

  function buildAgentErrorMessage(error: unknown, fallback: string) {
    const message = error instanceof Error ? error.message.trim() : '';
    if (!message) return fallback;
    return `${fallback}\n\n错误信息：${message}`;
  }

  async function handleUserTurn() {
    const userText = draftMessage.trim();
    if (!userText) return;

    pushMessage('user', userText);
    setDraftMessage('');
    setResolvedItem(null);

    await withAction(
      'agent-turn',
      async () => {
        const response = await agentTurn({
          userInput: userText,
          savedProfiles,
          activeCatalogId: activeProfile?.catalog_id ?? null,
          pendingCatalog,
          session: querySession,
          previousResults: catalogResults,
        });

        setPendingCatalog(response.pending_catalog);
        setQuerySession(response.next_session);
        setCatalogResults(response.result_items);
        if (response.selected_catalog_id) {
          const selected = savedProfiles.find((profile) => profile.catalog_id === response.selected_catalog_id) ?? null;
          if (selected) setActiveProfile(selected);
        }
        pushMessage('agent', response.agent_message);
      },
      (error) => {
        pushMessage(
          'agent',
          buildAgentErrorMessage(
            error,
            '这次 agent 请求没有成功完成，我暂时没法继续当前这轮检索。请稍后重试，或先检查 user-demo agent 的模型与网络配置。',
          ),
        );
      },
    );
  }

  async function handleRegisterPendingCatalog() {
    if (!pendingCatalog) return;
    if (!querySession) return;

    const profile: SavedCatalogProfile = {
      catalog_id: pendingCatalog.catalog_id,
      catalog_name: pendingCatalog.catalog_name,
      route_hint: pendingCatalog.route_hint,
      verification_status: pendingCatalog.verification_status,
      trust_tier: pendingCatalog.trust_tier,
      health_status: pendingCatalog.health_status,
      registered_at: new Date().toISOString(),
      last_used_at: new Date().toISOString(),
    };

    setSavedProfiles((current) => [profile, ...current.filter((item) => item.catalog_id !== profile.catalog_id)]);
    setActiveProfile(profile);
    setPendingCatalog(null);
    await withAction(
      'direct-query',
      async () => {
        const response = await confirmCatalogRegistration({
          pendingCatalog,
          session: querySession,
        });
        setCatalogResults(response.result_items);
        setQuerySession(response.next_session);
        pushMessage('agent', response.agent_message);
      },
      (error) => {
        pushMessage(
          'agent',
          buildAgentErrorMessage(
            error,
            'catalog profile 已保存，但继续查询这一步失败了。请稍后重试，或检查 agent 模型与 catalog 查询链路。',
          ),
        );
      },
    );
  }

  function handleClearMemory() {
    setSavedProfiles([]);
    setActiveProfile(null);
    setCatalogResults([]);
    setResolvedItem(null);
    setQuerySession(null);
    setPendingCatalog(null);
    setAgentMessages([
      {
        id: crypto.randomUUID(),
        role: 'agent',
        content: '本地 memory 已清空。我现在不记得任何 catalog profile 了。再找我查东西的话，我会重新去 OCP Center。',
      },
    ]);
  }

  return (
    <div className="flex h-screen w-full bg-[#f8f9fa] text-ink font-sans overflow-hidden">
      {/* Sidebar: Memory & Debug */}
      <motion.aside 
        initial={{ x: -300, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className="hidden lg:flex w-[340px] shrink-0 flex-col border-r border-ink/5 bg-white/70 backdrop-blur-xl"
      >
        <div className="flex items-start justify-between p-6">
          <div className="space-y-1">
            <h2 className="font-display text-2xl tracking-tight flex items-center gap-2">
              <Compass className="h-5 w-5 text-ink/40" />
              OCP Terminal
            </h2>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-ink/40">User Side Protocol</p>
          </div>
          <Button tone="outline" onClick={handleClearMemory} className="h-10 w-10 p-0 rounded-full text-ember border-ember/20 hover:bg-ember/5" title="Clear local memory">
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 pb-6 custom-scrollbar">
          <div className="space-y-3">
            <Label className="flex items-center gap-2 mb-4">
              <MemoryStick className="h-3.5 w-3.5" />
              Local Memory
            </Label>
            
            {savedProfiles.length === 0 ? (
              <div className="rounded-xl border border-dashed border-ink/10 bg-ink/[0.02] p-5 text-sm text-ink/40 text-center">
                Profile cache empty
              </div>
            ) : (
              <div className="space-y-3">
                <AnimatePresence>
                  {savedProfiles.map((p) => (
                    <motion.div
                      key={p.catalog_id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, height: 0 }}
                      className={cn(
                        "group relative cursor-pointer overflow-hidden rounded-xl border p-4 text-sm transition-all",
                        activeProfile?.catalog_id === p.catalog_id 
                          ? "border-spruce/30 bg-spruce/[0.03] shadow-sm" 
                          : "border-ink/5 bg-white hover:border-ink/15 hover:shadow-sm"
                      )}
                      onClick={() => setActiveProfile(p)}
                    >
                      {activeProfile?.catalog_id === p.catalog_id && (
                        <div className="absolute inset-y-0 left-0 w-1 bg-gradient-to-b from-spruce/60 to-spruce/20" />
                      )}
                      <div className="flex justify-between items-start mb-2">
                        <span className="font-semibold text-ink">{p.catalog_name}</span>
                        <Badge tone={p.health_status === 'healthy' ? 'success' : 'warning'}>{p.health_status}</Badge>
                      </div>
                      <div className="space-y-1.5 mt-3 text-[11px] text-ink/50 font-mono flex flex-col">
                        <div className="flex justify-between"><span>Trust:</span> <span className="text-ink/80">{p.trust_tier}</span></div>
                        <div className="flex justify-between"><span>Query Lang:</span> <span className="text-ink/80">{p.route_hint.metadata.query_hints?.supported_query_languages?.join(', ') || '-'}</span></div>
                        <div className="flex justify-between truncate" title={p.route_hint.query_url}><span>Endpoint:</span> <span className="truncate max-w-[120px] text-ink/80">{p.route_hint.query_url}</span></div>
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            )}
            
            {querySession && (
              <motion.div 
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="mt-8 border-t border-ink/5 pt-6"
              >
                <Label className="flex items-center gap-2 mb-4">
                  <Route className="h-3.5 w-3.5" />
                  Query Context
                </Label>
                <div className="rounded-xl border border-ink/5 bg-white p-4 text-xs font-mono">
                  <div className="text-ink/40 mb-1">Intent Tracker</div>
                  <div className="text-ink break-all border-b border-ink/5 pb-2 mb-2">"{querySession.baseIntent}"</div>
                  <div className="grid grid-cols-2 gap-2 mt-3">
                    <div className="text-ink/40">Sort:</div>
                    <div className="text-right text-spruce">{querySession.sortPreference}</div>
                    <div className="text-ink/40">Filters:</div>
                    <div className="text-right text-ink/80">
                      {Object.entries(querySession.activeFilters).length > 0
                        ? Object.entries(querySession.activeFilters)
                            .map(([key, value]) => `${key}=${value}`)
                            .join(', ')
                        : 'none'}
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </div>
        </div>
      </motion.aside>

      {/* Main Chat & Discover Interface */}
      <main className="flex flex-1 flex-col relative bg-white lg:rounded-l-3xl lg:border-l lg:border-ink/5 lg:shadow-[-20px_0_60px_-20px_rgba(0,0,0,0.05)]">
        {/* Background Mesh */}
        <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none mix-blend-multiply opacity-30">
           <div className="absolute inset-0 bg-[radial-gradient(#161412_1px,transparent_1px)] [background-size:24px_24px] opacity-[0.03]" />
        </div>

        {/* Message Thread */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-8 lg:p-12 z-10 custom-scrollbar scroll-smooth">
          <div className="mx-auto max-w-3xl space-y-8">
            <AnimatePresence>
              {agentMessages.map((msg, i) => {
                const isUser = msg.role === 'user';
                return (
                  <motion.div 
                    key={msg.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4, ease: "easeOut" }}
                    className={cn("flex flex-col", isUser ? "items-end" : "items-start")}
                  >
                    <div className={cn(
                      "flex items-end gap-3 max-w-[85%]",
                      isUser ? "flex-row-reverse" : "flex-row"
                    )}>
                      {!isUser && (
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ink text-white shadow-sm mb-1 ring-2 ring-white">
                          <Bot className="h-4 w-4" />
                        </div>
                      )}
                      
                      <div className={cn(
                        "rounded-2xl px-5 py-3.5 text-[15px] leading-relaxed shadow-sm",
                        isUser 
                          ? "bg-ink text-white rounded-br-none" 
                          : "bg-fog/20 text-ink border border-ink/5 rounded-bl-none"
                      )}>
                        {isUser ? (
                          msg.content
                        ) : (
                          renderAgentMarkdown(msg.content)
                        )}
                        
                        {/* Pending Catalog Injection Action */}
                        {!isUser && pendingCatalog && i === agentMessages.length - 1 && (
                          <motion.div 
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            className="mt-4 flex flex-col gap-3 rounded-xl border border-spruce/20 bg-white p-4 shadow-sm"
                          >
                            <div className="flex justify-between items-center">
                              <span className="font-semibold text-ink line-clamp-1">{pendingCatalog.catalog_name}</span>
                              <Badge tone="success">Verified</Badge>
                            </div>
                            <div className="text-xs text-ink/50 break-all bg-ink/5 p-2 rounded-lg font-mono">
                              {pendingCatalog.route_hint.query_url}
                            </div>
                            <Button 
                              tone="accent" 
                              className="mt-1 w-full rounded-xl"
                              onClick={() => void handleRegisterPendingCatalog()}
                            >
                              Save Catalog Locally
                            </Button>
                          </motion.div>
                        )}
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
            <div ref={messagesEndRef} className="h-4" />
          </div>
        </div>

        {/* Results Sheet - Rendered Inline Over Chat if it exists */}
        <AnimatePresence>
          {catalogResults.length > 0 && (
            <motion.div 
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="z-20 border-t border-ink/5 bg-white"
            >
               <div className="mx-auto max-w-7xl overflow-x-auto p-6 scrollbar-hide">
                 <div className="flex gap-4 pb-4">
                    {catalogResults.map((item, index) => (
                      <motion.div 
                        initial={{ opacity: 0, scale: 0.9, x: 20 }}
                        animate={{ opacity: 1, scale: 1, x: 0 }}
                        transition={{ delay: index * 0.05 }}
                        key={item.entry_id}
                        className="group flex w-[260px] shrink-0 cursor-pointer flex-col overflow-hidden rounded-2xl border border-ink/5 bg-white shadow-sm transition hover:-translate-y-1 hover:shadow-md hover:border-ink/15"
                        onClick={() => void withAction(`resolve-${item.entry_id}`, async () => {
                          if (!activeProfile) return;
                          const res = await resolveEntry(activeProfile.route_hint, item.entry_id);
                          setResolvedItem(res);
                          setResolveOpen(true);
                        })}
                      >
                         <div className="relative h-[160px] w-full bg-fog/20 overflow-hidden">
                           <img 
                              src={(item.attributes.image_urls as string[])?.[0] || resultImages[index % resultImages.length]}
                              alt={item.title}
                              className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
                           />
                           <div className="absolute inset-0 bg-gradient-to-t from-ink/80 via-transparent to-transparent" />
                           <div className="absolute inset-x-0 bottom-0 p-4">
                             <div className="flex gap-2">
                                <Badge tone={(item.attributes.availability_status as string) === 'out_of_stock' ? 'danger' : 'neutral'}>
                                  {((item.attributes.availability_status as string) || '').replace('_', ' ')}
                               </Badge>
                             </div>
                           </div>
                         </div>
                         <div className="flex flex-1 flex-col p-4">
                           <h3 className="font-semibold leading-tight text-ink line-clamp-2">{item.title}</h3>
                           <div className="mt-3 flex items-center justify-between">
                              <span className="font-display text-2xl text-ink">
                                 {formatMoney(
                                   (typeof item.attributes.amount === 'number' ? item.attributes.amount : 0) as number,
                                   (typeof item.attributes.currency === 'string' ? item.attributes.currency : 'USD') as string,
                                 )}
                              </span>
                              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-ink/5 text-ink/40 transition group-hover:bg-spruce group-hover:text-white">
                                <ArrowRight className="h-4 w-4" />
                              </div>
                           </div>
                         </div>
                      </motion.div>
                    ))}
                 </div>
               </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Action Bar */}
        <div className="z-30 p-4 sm:p-6 bg-white border-t border-ink/5">
          <div className="mx-auto max-w-3xl relative">
            <div className="relative flex items-center bg-white shadow-[0_8px_30px_rgb(0,0,0,0.06)] rounded-2xl border border-ink/10 ring-1 ring-inset ring-white/50 transition-shadow focus-within:shadow-[0_8px_40px_rgb(0,0,0,0.12)]">
              <input 
                type="text"
                className="h-14 w-full rounded-2xl bg-transparent pl-6 pr-16 outline-none placeholder:text-ink/30 text-[15px] font-medium"
                placeholder={busyAction === 'agent-turn' ? "Thinking..." : "Ask the agent anything, eg 'I want a pair of headphones'"}
                value={draftMessage}
                onChange={(e) => setDraftMessage(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void handleUserTurn();
                  }
                }}
                disabled={Boolean(busyAction)}
              />
              <div className="absolute right-2 top-1/2 -translate-y-1/2">
                <Button 
                  tone="accent" 
                  className={cn("h-10 w-10 p-0 rounded-xl", Boolean(busyAction) && "opacity-50")}
                  onClick={() => void handleUserTurn()}
                  disabled={Boolean(busyAction) || !draftMessage.trim()}
                >
                  {busyAction === 'agent-turn' ? (
                    <LoaderCircle className="h-5 w-5 animate-spin" />
                  ) : (
                    <ArrowRight className="h-5 w-5 hover:scale-110 transition-transform" />
                  )}
                </Button>
              </div>
            </div>
            <div className="mt-3 flex justify-center gap-4 text-[11px] font-medium text-ink/30">
              <span className="flex items-center gap-1.5"><Sparkles className="h-3 w-3" /> Connects to OCP</span>
              <span className="flex items-center gap-1.5"><Bot className="h-3 w-3" /> Auto-negotiates Manifests</span>
            </div>
          </div>
        </div>
      </main>

      {/* Resolved Modal */}
      <Modal
        open={resolveOpen}
        onOpenChange={setResolveOpen}
        title={<span className="font-display text-4xl">{resolvedItem?.title || 'Resolved Entry'}</span>}
        description={
          resolvedItem && (
             <div className="mt-2 flex gap-2">
               <Badge tone="success">Resolved Object</Badge>
               <Badge tone="neutral">Origin: {resolvedItem.provider_id}</Badge>
             </div>
          )
        }
      >
         {resolvedItem && (
            <div className="mt-6 space-y-6">
              <div className="flex flex-col gap-6 md:flex-row">
                 {((resolvedItem.visible_attributes as any).image_urls as string[])?.[0] && (
                   <div className="relative h-64 w-full md:w-64 shrink-0 overflow-hidden rounded-2xl bg-fog/20 border border-ink/5">
                     <img 
                       src={((resolvedItem.visible_attributes as any).image_urls as string[])[0]} 
                       alt="" 
                       className="h-full w-full object-cover" 
                     />
                   </div>
                 )}
                 
                 <div className="flex-1 space-y-4">
                   <div className="space-y-1">
                      <Label>Standard Pricing</Label>
                      <div className="font-display text-5xl">
                        {formatMoney(
                          Number((resolvedItem.visible_attributes as any).amount ?? 0),
                          String((resolvedItem.visible_attributes as any).currency ?? 'USD'),
                        )}
                      </div>
                   </div>

                   <p className="text-sm leading-relaxed text-ink/60">
                     {String((resolvedItem.visible_attributes as any).summary ?? '')}
                   </p>

                   <div className="grid grid-cols-2 gap-4 rounded-xl border border-ink/5 bg-ink/[0.02] p-4 text-sm">
                      <div>
                        <span className="block text-ink/40 text-xs font-semibold uppercase tracking-wider mb-1">Brand</span>
                        <span className="font-medium text-ink">{String((resolvedItem.visible_attributes as any).brand ?? '-')}</span>
                      </div>
                      <div>
                        <span className="block text-ink/40 text-xs font-semibold uppercase tracking-wider mb-1">Availability</span>
                        <span className="font-medium text-ink">{String((resolvedItem.visible_attributes as any).availability_status ?? 'unknown').replace('_', ' ')}</span>
                      </div>
                   </div>
                 </div>
              </div>

              {selectedTopAction && (
                <div className="mt-8 border-t border-ink/5 pt-6 flex justify-end">
                  <a
                    href={selectedTopAction.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-ink px-8 text-sm font-semibold tracking-wide text-white transition hover:bg-black hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-ink/20"
                  >
                    {selectedTopAction.label}
                    {selectedTopAction.action_id === 'buy_now' ? ' →' : <ExternalLink className="h-4 w-4" />}
                  </a>
                </div>
              )}
            </div>
         )}
      </Modal>

      {/* Toast Render */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: -50, x: '-50%' }}
            animate={{ opacity: 1, y: 0, x: '-50%' }}
            exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.2 } }}
            className={cn(
              "fixed top-6 max-w-sm left-1/2 z-[100] flex items-center gap-3 rounded-full border px-5 py-3 pr-6 text-sm font-medium shadow-2xl backdrop-blur-md",
              toast.tone === 'success' ? 'border-spruce/30 bg-spruce/95 text-white' : 'border-ember/30 bg-ember/95 text-white'
            )}
          >
            {toast.message}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function readSavedProfiles(): SavedCatalogProfile[] {
  try {
    const raw = window.localStorage.getItem(localProfilesStorageKey);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function writeSavedProfiles(profiles: SavedCatalogProfile[]) {
  window.localStorage.setItem(localProfilesStorageKey, JSON.stringify(profiles));
}

function renderAgentMarkdown(content: string) {
  const lines = content.split(/\r?\n/);
  const blocks: ReactNode[] = [];
  let listBuffer: string[] = [];
  let orderedBuffer: string[] = [];

  const flushLists = () => {
    if (listBuffer.length > 0) {
      blocks.push(
        <ul key={`ul-${blocks.length}`} className="my-2 list-disc space-y-1 pl-5">
          {listBuffer.map((item, index) => <li key={index}>{renderInlineMarkdown(item)}</li>)}
        </ul>,
      );
      listBuffer = [];
    }

    if (orderedBuffer.length > 0) {
      blocks.push(
        <ol key={`ol-${blocks.length}`} className="my-2 list-decimal space-y-1 pl-5">
          {orderedBuffer.map((item, index) => <li key={index}>{renderInlineMarkdown(item)}</li>)}
        </ol>,
      );
      orderedBuffer = [];
    }
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      flushLists();
      continue;
    }

    const orderedMatch = trimmed.match(/^\d+\.\s+(.*)$/);
    if (orderedMatch) {
      orderedBuffer.push(orderedMatch[1]);
      continue;
    }

    const bulletMatch = trimmed.match(/^[-*]\s+(.*)$/);
    if (bulletMatch) {
      listBuffer.push(bulletMatch[1]);
      continue;
    }

    flushLists();
    blocks.push(
      <p key={`p-${blocks.length}`} className="my-0 whitespace-pre-wrap font-medium leading-relaxed">
        {renderInlineMarkdown(trimmed)}
      </p>,
    );
  }

  flushLists();
  return <div className="space-y-2">{blocks}</div>;
}

function renderInlineMarkdown(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g).filter(Boolean);
  return parts.map((part, index) => {
    const linkMatch = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (linkMatch) {
      return (
        <a
          key={index}
          href={linkMatch[2]}
          target="_blank"
          rel="noreferrer"
          className="text-spruce underline decoration-spruce/30 underline-offset-2"
        >
          {linkMatch[1]}
        </a>
      );
    }

    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={index} className="font-semibold text-ink">{part.slice(2, -2)}</strong>;
    }

    if (part.startsWith('`') && part.endsWith('`')) {
      return <code key={index} className="rounded bg-ink/5 px-1.5 py-0.5 font-mono text-[0.9em]">{part.slice(1, -1)}</code>;
    }

    return <Fragment key={index}>{part}</Fragment>;
  });
}

function formatMoney(amountInCents: number, currency: string) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(amountInCents);
}

import { ArrowUpRight, Boxes, CloudUpload, PackagePlus, RefreshCcw, SearchCheck, Store } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  createProduct,
  deactivateProduct,
  fetchProviderStatus,
  fetchProducts,
  fetchSyncRuns,
  publishToCatalog,
  registerToCatalog,
  seedDemoProducts,
  syncAllProducts,
  syncOneProduct,
  updateProduct,
  type ProviderStatusRecord,
  type ProductFormInput,
  type ProductRecord,
  type SyncRunRecord,
} from './api';
import { Badge, Button, Label, Metric, Modal, Panel, Select, TextArea, TextInput } from './components';

type ToastState = { tone: 'success' | 'danger'; message: string } | null;

const availabilityOptions = ['in_stock', 'low_stock', 'out_of_stock', 'preorder', 'unknown'] as const;
const statusOptions = ['active', 'inactive', 'draft'] as const;
const priceTypeOptions = ['fixed', 'range'] as const;

const fallbackImages = [
  'https://images.unsplash.com/photo-1511499767150-a48a237f0083?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1441986300917-64674bd600d8?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=1200&q=80',
];

const emptyProductForm: ProductFormInput = {
  sku: '',
  title: '',
  summary: '',
  brand: '',
  category: '',
  product_url: '',
  image_urls: [],
  currency: 'USD',
  amount: 0,
  list_amount: undefined,
  price_type: 'fixed',
  availability_status: 'in_stock',
  quantity: 0,
  status: 'active',
  attributes: {},
};

export function App() {
  const [apiKey, setApiKey] = useState(() => window.localStorage.getItem('provider-admin-api-key') || 'dev-api-key');
  const [registrationVersion, setRegistrationVersion] = useState(1);
  const [providerStatus, setProviderStatus] = useState<ProviderStatusRecord | null>(null);
  const [products, setProducts] = useState<ProductRecord[]>([]);
  const [syncRuns, setSyncRuns] = useState<SyncRunRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [editingProduct, setEditingProduct] = useState<ProductRecord | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [toast, setToast] = useState<ToastState>(null);

  useEffect(() => {
    window.localStorage.setItem('provider-admin-api-key', apiKey);
  }, [apiKey]);

  useEffect(() => {
    void reloadAll();
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2800);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const activeCount = useMemo(() => products.filter((product) => product.status === 'active').length, [products]);
  const inStockCount = useMemo(
    () => products.filter((product) => product.availabilityStatus === 'in_stock' || product.availabilityStatus === 'low_stock').length,
    [products],
  );
  const qualitySummary = providerStatus?.local_quality ?? null;
  const publishReadiness = providerStatus?.publish_readiness ?? null;
  const catalogQuality = providerStatus?.catalog_quality ?? null;
  const latestRun = syncRuns[0] ?? null;

  async function reloadAll() {
    try {
      setLoading(true);
      const [nextProducts, nextRuns, nextStatus] = await Promise.all([
        fetchProducts(apiKey),
        fetchSyncRuns(apiKey),
        fetchProviderStatus(apiKey),
      ]);
      setProducts(nextProducts);
      setSyncRuns(nextRuns);
      setProviderStatus(nextStatus);
      setRegistrationVersion(nextStatus.next_registration_version);
    } catch (error) {
      showError(error);
    } finally {
      setLoading(false);
    }
  }

  async function withAction(actionKey: string, fn: () => Promise<void>) {
    try {
      setBusyAction(actionKey);
      await fn();
    } catch (error) {
      showError(error);
    } finally {
      setBusyAction(null);
    }
  }

  function showError(error: unknown) {
    setToast({
      tone: 'danger',
      message: error instanceof Error ? error.message : 'Unexpected error',
    });
  }

  function showSuccess(message: string) {
    setToast({ tone: 'success', message });
  }

  async function handleSubmitProduct(input: ProductFormInput) {
    await withAction(editingProduct ? `save-${editingProduct.id}` : 'create-product', async () => {
      if (editingProduct) {
        await updateProduct(apiKey, editingProduct.id, input);
        showSuccess(`Updated ${input.title}`);
      } else {
        await createProduct(apiKey, input);
        showSuccess(`Created ${input.title}`);
      }
      setModalOpen(false);
      setEditingProduct(null);
      await reloadAll();
    });
  }

  return (
    <div className="min-h-screen bg-paper text-ink">
      <div className="fixed inset-0 bg-grid bg-[size:28px_28px] opacity-35" />
      <div className="relative mx-auto flex w-full max-w-[1480px] flex-col gap-6 px-4 py-4 sm:px-6 lg:px-8">
        <header className="grid gap-4 rounded-md border border-ink/10 bg-white px-5 py-5 shadow-card lg:grid-cols-[1.25fr_0.75fr] lg:px-7">
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <Badge tone="success">Provider Admin</Badge>
              <Badge tone="neutral">Commerce scene</Badge>
            </div>
            <div className="max-w-[14ch] font-display text-[clamp(2.8rem,6vw,5.8rem)] leading-[0.9] text-ink">
              Stock desk for live catalog supply.
            </div>
            <p className="max-w-[58ch] text-sm leading-6 text-ink/62">
              Manage provider inventory, publish registration handshakes, push synchronized products into the catalog, and keep the supply line ready for center discovery.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Panel className="overflow-hidden">
              <div className="relative h-full min-h-[220px] bg-ink p-5 text-paper">
                <div
                  className="absolute inset-y-0 right-0 w-[54%] bg-cover bg-center opacity-80 mix-blend-screen"
                  style={{ backgroundImage: `url(${fallbackImages[0]})` }}
                />
                <div className="relative z-10 flex h-full flex-col justify-between">
                  <div className="space-y-2">
                    <span className="text-xs font-semibold uppercase tracking-[0.16em] text-paper/70">API access</span>
                    <div className="font-display text-3xl leading-none">Operator key</div>
                  </div>
                  <div className="space-y-3">
                    <TextInput
                      type="password"
                      value={apiKey}
                      onChange={(event) => setApiKey(event.target.value)}
                      placeholder="dev-api-key"
                      className="border-paper/20 bg-paper/10 text-paper placeholder:text-paper/45 focus:border-paper/50"
                    />
                    <p className="text-xs leading-5 text-paper/65">Stored locally in this browser. Used for admin writes and provider sync controls.</p>
                  </div>
                </div>
              </div>
            </Panel>
            <Panel className="p-5">
              <div className="flex h-full flex-col justify-between gap-4">
                <div className="space-y-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.16em] text-ink/55">Registration version</span>
                  <div className="font-display text-3xl leading-none">{registrationVersion}</div>
                  <p className="text-xs leading-5 text-ink/55">
                    Active in catalog: {providerStatus?.active_registration_version ?? 'none'} · Next suggested: {providerStatus?.next_registration_version ?? registrationVersion}
                  </p>
                </div>
                <div className="space-y-3">
                  <TextInput
                    type="number"
                    min={1}
                    value={registrationVersion}
                    onChange={(event) => setRegistrationVersion(Number(event.target.value || 1))}
                  />
                  <div className="grid gap-2">
                    <Button
                      tone="accent"
                      busy={busyAction === 'publish'}
                      onClick={() =>
                        void withAction('publish', async () => {
                          await publishToCatalog(apiKey, registrationVersion);
                          await reloadAll();
                          showSuccess('Provider registered and products synchronized');
                        })
                      }
                    >
                      <Store className="h-4 w-4" />
                      Register + sync
                    </Button>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <Button
                        tone="secondary"
                        busy={busyAction === 'register'}
                        onClick={() =>
                          void withAction('register', async () => {
                            await registerToCatalog(apiKey, registrationVersion);
                            await reloadAll();
                            showSuccess('Provider registration pushed to catalog');
                          })
                        }
                      >
                        <Store className="h-4 w-4" />
                        Register only
                      </Button>
                      <Button
                        tone="default"
                        busy={busyAction === 'sync-all'}
                        onClick={() =>
                          void withAction('sync-all', async () => {
                            await syncAllProducts(apiKey, providerStatus?.active_registration_version ?? registrationVersion);
                            await reloadAll();
                            showSuccess('All products synchronized to catalog');
                          })
                        }
                      >
                        <CloudUpload className="h-4 w-4" />
                        Sync all
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            </Panel>
          </div>
        </header>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Metric label="Products" value={products.length} note="All local provider rows" />
          <Metric label="Active" value={activeCount} note="Eligible for sync when available" />
          <Metric label="Sellable" value={inStockCount} note="In stock or low stock" />
          <Metric
            label="Latest sync"
            value={latestRun ? latestRun.runType.replace('_', ' ') : 'none'}
            note={latestRun ? formatTimestamp(latestRun.createdAt) : 'No provider sync activity yet'}
          />
        </div>

        {qualitySummary ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Metric label="Missing images" value={qualitySummary.missing_image_count} note="Products without a primary visual" />
            <Metric label="Missing list price" value={qualitySummary.missing_list_price_count} note="No compare-at price or no discount context" />
            <Metric label="Missing URL" value={qualitySummary.missing_product_url_count} note="Products that cannot deep-link cleanly" />
            <Metric label="Missing brand/category" value={qualitySummary.missing_brand_or_category_count} note="Thin taxonomy data lowers retrieval quality" />
          </div>
        ) : null}

        {(publishReadiness || catalogQuality) ? (
          <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
            <Panel className="p-5">
              <div className="space-y-4">
                <div className="space-y-1">
                  <div className="text-xs font-semibold uppercase tracking-[0.16em] text-ink/55">Pre-publish</div>
                  <div className="font-display text-3xl leading-none">Feed readiness</div>
                </div>
                {publishReadiness ? (
                  <div className="space-y-3 text-sm text-ink/68">
                    <Badge tone={publishReadiness.ready ? 'success' : 'warning'}>
                      {publishReadiness.ready ? 'ready to publish' : 'needs cleanup'}
                    </Badge>
                    <div>Ready products: {qualitySummary?.ready_for_publish_count ?? 0} / {qualitySummary?.active_count ?? 0} active rows</div>
                    {publishReadiness.blocking_issues.length ? (
                      <div className="rounded-md border border-ember/15 bg-ember/5 p-3">
                        {publishReadiness.blocking_issues.map((issue) => (
                          <div key={issue} className="text-ember">{issue}</div>
                        ))}
                      </div>
                    ) : null}
                    {publishReadiness.warnings.length ? (
                      <div className="rounded-md border border-brass/15 bg-brass/5 p-3">
                        {publishReadiness.warnings.map((warning) => (
                          <div key={warning} className="text-ink/72">{warning}</div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </Panel>

            <Panel className="p-5">
              <div className="space-y-4">
                <div className="space-y-1">
                  <div className="text-xs font-semibold uppercase tracking-[0.16em] text-ink/55">Catalog feedback</div>
                  <div className="font-display text-3xl leading-none">Indexed quality</div>
                </div>
                {catalogQuality ? (
                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                    <Metric label="Indexed" value={catalogQuality.object_count} note="Provider objects observed by catalog" />
                    <Metric label="Rich" value={catalogQuality.rich_entry_count} note="Best result-card quality" />
                    <Metric label="Standard" value={catalogQuality.standard_entry_count} note="Normal commerce rows" />
                    <Metric label="Basic" value={catalogQuality.basic_entry_count} note="Thin rows that still index" />
                  </div>
                ) : (
                  <div className="rounded-md border border-dashed border-ink/15 bg-paper/50 p-4 text-sm text-ink/58">
                    Catalog feedback will appear after registration and sync.
                  </div>
                )}
              </div>
            </Panel>
          </div>
        ) : null}

        <div className="grid gap-6 xl:grid-cols-[1.35fr_0.65fr]">
          <Panel className="overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink/10 px-5 py-4">
              <div className="space-y-1">
                <div className="text-xs font-semibold uppercase tracking-[0.16em] text-ink/55">Catalog supply</div>
                <div className="font-display text-3xl leading-none">Product registry</div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  tone="secondary"
                  busy={busyAction === 'reload'}
                  onClick={() => void withAction('reload', reloadAll)}
                >
                  <RefreshCcw className="h-4 w-4" />
                  Refresh
                </Button>
                <Button
                  tone="secondary"
                  busy={busyAction === 'seed-demo'}
                  onClick={() =>
                    void withAction('seed-demo', async () => {
                      await seedDemoProducts(apiKey);
                      await reloadAll();
                      showSuccess('Demo products seeded');
                    })
                  }
                >
                  <PackagePlus className="h-4 w-4" />
                  Seed demo
                </Button>
                <Button tone="default" onClick={() => {
                  setEditingProduct(null);
                  setModalOpen(true);
                }}>
                  <Boxes className="h-4 w-4" />
                  Add product
                </Button>
              </div>
            </div>

            <div className="grid gap-3 p-4 lg:grid-cols-2">
              {loading ? (
                Array.from({ length: 4 }).map((_, index) => (
                  <div key={index} className="h-[240px] animate-pulse rounded-md border border-ink/10 bg-paper" />
                ))
              ) : products.length === 0 ? (
                <div className="col-span-full flex min-h-[340px] flex-col items-center justify-center gap-4 rounded-md border border-dashed border-ink/15 bg-paper/65 p-8 text-center">
                  <div className="font-display text-4xl">No products loaded yet.</div>
                  <p className="max-w-[40ch] text-sm leading-6 text-ink/58">
                    Seed demo rows or create your own product records first, then register and sync this provider into the catalog.
                  </p>
                </div>
              ) : (
                products.map((product, index) => (
                  <article key={product.id} className="grid overflow-hidden rounded-md border border-ink/10 bg-white shadow-card md:grid-cols-[0.85fr_1.15fr]">
                    <div className="relative min-h-[230px] bg-ink">
                      <img
                        src={product.imageUrls[0] || fallbackImages[index % fallbackImages.length]}
                        alt={product.title}
                        className="h-full w-full object-cover"
                        onError={(event) => {
                          const img = event.currentTarget;
                          img.src = fallbackImages[index % fallbackImages.length];
                        }}
                      />
                      <div className="absolute inset-x-0 bottom-0 flex flex-wrap gap-2 bg-gradient-to-t from-ink/80 to-transparent p-4">
                        <Badge tone={product.status === 'active' ? 'success' : product.status === 'draft' ? 'warning' : 'danger'}>
                          {product.status}
                        </Badge>
                        <Badge tone={product.availabilityStatus === 'out_of_stock' ? 'danger' : 'neutral'}>
                          {product.availabilityStatus.replaceAll('_', ' ')}
                        </Badge>
                      </div>
                    </div>
                    <div className="flex flex-col gap-4 p-5">
                      <div className="space-y-2">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <h2 className="text-xl font-semibold leading-tight text-ink">{product.title}</h2>
                            <p className="mt-1 text-xs font-semibold uppercase tracking-[0.16em] text-ink/45">{product.brand} / {product.category}</p>
                          </div>
                          <a href={product.productUrl} target="_blank" rel="noreferrer" className="rounded-md border border-ink/10 p-2 text-ink/55 transition hover:border-ink/20 hover:text-ink">
                            <ArrowUpRight className="h-4 w-4" />
                          </a>
                        </div>
                        <p className="text-sm leading-6 text-ink/62">{product.summary}</p>
                      </div>

                      <dl className="grid gap-3 text-sm sm:grid-cols-2">
                        <div>
                          <dt className="text-xs font-semibold uppercase tracking-[0.14em] text-ink/45">SKU</dt>
                          <dd className="mt-1 font-medium text-ink">{product.sku}</dd>
                        </div>
                        <div>
                          <dt className="text-xs font-semibold uppercase tracking-[0.14em] text-ink/45">Price</dt>
                          <dd className="mt-1 font-medium text-ink">
                            {formatMoney(product.amount, product.currency)}
                            {product.listAmount && product.listAmount > product.amount ? ` · was ${formatMoney(product.listAmount, product.currency)}` : ''}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-xs font-semibold uppercase tracking-[0.14em] text-ink/45">Quantity</dt>
                          <dd className="mt-1 font-medium text-ink">{product.quantity}</dd>
                        </div>
                        <div>
                          <dt className="text-xs font-semibold uppercase tracking-[0.14em] text-ink/45">Updated</dt>
                          <dd className="mt-1 font-medium text-ink">{formatTimestamp(product.updatedAt)}</dd>
                        </div>
                      </dl>

                      <div className="mt-auto flex flex-wrap gap-2">
                        <Button tone="secondary" onClick={() => {
                          setEditingProduct(product);
                          setModalOpen(true);
                        }}>
                          Edit
                        </Button>
                        <Button
                          tone="accent"
                          busy={busyAction === `sync-${product.id}`}
                          onClick={() =>
                            void withAction(`sync-${product.id}`, async () => {
                              await syncOneProduct(apiKey, product.id, providerStatus?.active_registration_version ?? registrationVersion);
                              await reloadAll();
                              showSuccess(`${product.title} synchronized to catalog`);
                            })
                          }
                        >
                          <SearchCheck className="h-4 w-4" />
                          Sync
                        </Button>
                        <Button
                          tone="danger"
                          busy={busyAction === `deactivate-${product.id}`}
                          onClick={() =>
                            void withAction(`deactivate-${product.id}`, async () => {
                              await deactivateProduct(apiKey, product.id);
                              await reloadAll();
                              showSuccess(`${product.title} marked inactive`);
                            })
                          }
                        >
                          Deactivate
                        </Button>
                      </div>
                    </div>
                  </article>
                ))
              )}
            </div>
          </Panel>

          <div className="grid gap-6">
            <Panel className="p-5">
              <div className="space-y-4">
                <div className="space-y-1">
                  <div className="text-xs font-semibold uppercase tracking-[0.16em] text-ink/55">Workflow</div>
                  <div className="font-display text-3xl leading-none">Chain checkpoint</div>
                </div>
                <ol className="space-y-3 text-sm leading-6 text-ink/65">
                  <li>1. Start `center:api`, `commerce:catalog:api`, `commerce:provider:api`.</li>
                  <li>2. Register catalog into OCP Center.</li>
                  <li>3. Register provider from this console, then let provider push product batches into the commerce catalog.</li>
                  <li>4. Verify catalog search results from the user demo or direct OCP query.</li>
                </ol>
              </div>
            </Panel>

            <Panel className="overflow-hidden">
              <div className="border-b border-ink/10 px-5 py-4">
                <div className="text-xs font-semibold uppercase tracking-[0.16em] text-ink/55">Provider activity</div>
                <div className="mt-1 font-display text-3xl leading-none">Recent sync runs</div>
              </div>
              <div className="max-h-[580px] space-y-3 overflow-auto p-4">
                {syncRuns.length === 0 ? (
                  <div className="rounded-md border border-dashed border-ink/15 bg-paper/60 p-5 text-sm text-ink/58">
                    No provider sync runs yet.
                  </div>
                ) : (
                  syncRuns.map((run) => (
                    <div key={run.id} className="rounded-md border border-ink/10 bg-paper/50 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-semibold capitalize text-ink">{run.runType.replaceAll('_', ' ')}</div>
                          <div className="mt-1 text-xs uppercase tracking-[0.14em] text-ink/45">{formatTimestamp(run.createdAt)}</div>
                        </div>
                        <Badge tone={run.status === 'succeeded' ? 'success' : run.status === 'failed' ? 'danger' : 'warning'}>
                          {run.status}
                        </Badge>
                      </div>
                      <div className="mt-3 grid gap-2 text-sm text-ink/62">
                        <div>Registration v{run.registrationVersion ?? '-'}</div>
                        {run.targetProductId ? <div>Product target: {run.targetProductId}</div> : null}
                        {run.error ? <div className="text-ember">{run.error}</div> : null}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </Panel>
          </div>
        </div>
      </div>

      <ProductModal
        key={editingProduct?.id ?? 'new'}
        open={modalOpen}
        initialValue={editingProduct}
        onOpenChange={(open) => {
          setModalOpen(open);
          if (!open) setEditingProduct(null);
        }}
        onSubmit={handleSubmitProduct}
        busy={Boolean(busyAction && (busyAction.startsWith('save-') || busyAction === 'create-product'))}
      />

      {toast ? (
        <div className={`fixed bottom-5 right-5 z-50 rounded-md border px-4 py-3 text-sm shadow-card ${
          toast.tone === 'success' ? 'border-spruce/25 bg-spruce text-paper' : 'border-ember/20 bg-ember text-paper'
        }`}>
          {toast.message}
        </div>
      ) : null}
    </div>
  );
}

function ProductModal({
  open,
  initialValue,
  onOpenChange,
  onSubmit,
  busy,
}: {
  open: boolean;
  initialValue: ProductRecord | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: ProductFormInput) => Promise<void>;
  busy: boolean;
}) {
  const [form, setForm] = useState<ProductFormInput>(() => toFormInput(initialValue));
  const [attributesText, setAttributesText] = useState(() => JSON.stringify(toFormInput(initialValue).attributes, null, 2));
  const [imagesText, setImagesText] = useState(() => toFormInput(initialValue).image_urls.join('\n'));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const next = toFormInput(initialValue);
    setForm(next);
    setAttributesText(JSON.stringify(next.attributes, null, 2));
    setImagesText(next.image_urls.join('\n'));
    setError(null);
  }, [initialValue, open]);

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={initialValue ? 'Edit product' : 'Add product'}
      description="Keep source-of-truth product fields clean here. Sync actions transform these rows into OCP commercial objects for the catalog."
    >
      <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          try {
            const parsedAttributes = attributesText.trim() ? JSON.parse(attributesText) : {};
            if (typeof parsedAttributes !== 'object' || Array.isArray(parsedAttributes) || parsedAttributes === null) {
              setError('Attributes must be a JSON object.');
              return;
            }
            setError(null);
            void onSubmit({
              ...form,
              product_url: form.product_url?.trim() || undefined,
              image_urls: imagesText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean),
              attributes: parsedAttributes as Record<string, unknown>,
            });
          } catch {
            setError('Attributes must be valid JSON.');
          }
        }}
      >
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="SKU">
            <TextInput value={form.sku} onChange={(event) => setForm({ ...form, sku: event.target.value })} required />
          </Field>
          <Field label="Title">
            <TextInput value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} required />
          </Field>
          <Field label="Brand">
            <TextInput value={form.brand} onChange={(event) => setForm({ ...form, brand: event.target.value })} required />
          </Field>
          <Field label="Category">
            <TextInput value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })} required />
          </Field>
          <Field label="Currency">
            <TextInput value={form.currency} onChange={(event) => setForm({ ...form, currency: event.target.value.toUpperCase() })} required />
          </Field>
          <Field label="Amount">
            <TextInput type="number" min="0" step="0.01" value={form.amount} onChange={(event) => setForm({ ...form, amount: Number(event.target.value || 0) })} required />
          </Field>
          <Field label="List amount">
            <TextInput
              type="number"
              min="0"
              step="0.01"
              value={form.list_amount ?? ''}
              onChange={(event) => setForm({ ...form, list_amount: event.target.value ? Number(event.target.value) : undefined })}
            />
          </Field>
          <Field label="Price type">
            <Select value={form.price_type} onChange={(event) => setForm({ ...form, price_type: event.target.value as ProductFormInput['price_type'] })}>
              {priceTypeOptions.map((option) => <option key={option} value={option}>{option}</option>)}
            </Select>
          </Field>
          <Field label="Availability">
            <Select value={form.availability_status} onChange={(event) => setForm({ ...form, availability_status: event.target.value as ProductFormInput['availability_status'] })}>
              {availabilityOptions.map((option) => <option key={option} value={option}>{option}</option>)}
            </Select>
          </Field>
          <Field label="Status">
            <Select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as ProductFormInput['status'] })}>
              {statusOptions.map((option) => <option key={option} value={option}>{option}</option>)}
            </Select>
          </Field>
          <Field label="Quantity">
            <TextInput type="number" min="0" value={form.quantity} onChange={(event) => setForm({ ...form, quantity: Number(event.target.value || 0) })} />
          </Field>
          <Field label="Product URL">
            <TextInput value={form.product_url} onChange={(event) => setForm({ ...form, product_url: event.target.value })} placeholder="https://provider.example/products/sku" />
          </Field>
        </div>

        <Field label="Summary">
          <TextArea value={form.summary} onChange={(event) => setForm({ ...form, summary: event.target.value })} required />
        </Field>

        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Image URLs">
            <TextArea value={imagesText} onChange={(event) => setImagesText(event.target.value)} placeholder="One URL per line" />
          </Field>
          <Field label="Attributes JSON">
            <TextArea value={attributesText} onChange={(event) => setAttributesText(event.target.value)} spellCheck={false} />
          </Field>
        </div>

        {error ? <div className="rounded-md border border-ember/15 bg-ember/8 px-3 py-2 text-sm text-ember">{error}</div> : null}

        <div className="flex justify-end gap-2">
          <Button type="button" tone="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" tone="default" busy={busy}>{initialValue ? 'Save changes' : 'Create product'}</Button>
        </div>
      </form>
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function toFormInput(record: ProductRecord | null): ProductFormInput {
  if (!record) return emptyProductForm;
  return {
    sku: record.sku,
    title: record.title,
    summary: record.summary,
    brand: record.brand,
    category: record.category,
    product_url: record.productUrl,
    image_urls: record.imageUrls,
    currency: record.currency,
    amount: record.amount / 100,
    list_amount: record.listAmount ? record.listAmount / 100 : undefined,
    price_type: record.priceType,
    availability_status: record.availabilityStatus,
    quantity: record.quantity,
    status: record.status,
    attributes: record.attributes,
  };
}

function formatMoney(amountInCents: number, currency: string) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(amountInCents / 100);
}

function formatTimestamp(value: string) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

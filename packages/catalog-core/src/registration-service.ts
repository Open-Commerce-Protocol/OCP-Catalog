import type { Db } from '@ocp-catalog/db';
import { schema } from '@ocp-catalog/db';
import {
  providerRegistrationSchema,
  type ObjectContract,
  type ProviderRegistration,
  type RegistrationResult,
  type SelectedSyncCapability,
  type SyncCapability,
} from '@ocp-catalog/ocp-schema';
import { AppError, newId } from '@ocp-catalog/shared';
import { and, desc, eq } from 'drizzle-orm';
import type { AppConfig } from '@ocp-catalog/config';
import type { CatalogScenarioModule } from './scenario';
import { asProjection } from './projection';

export type RequestMeta = {
  sourceIp?: string | null;
  userAgent?: string | null;
};

type DeclarationMatch = {
  contract: ObjectContract;
  declaration: ProviderRegistration['object_declarations'][number];
  selectedSyncCapability: SelectedSyncCapability;
};

export class RegistrationService {
  constructor(
    private readonly db: Db,
    private readonly config: AppConfig,
    private readonly scenario: CatalogScenarioModule,
  ) {}

  async register(input: unknown, meta: RequestMeta = {}): Promise<RegistrationResult> {
    const registration = providerRegistrationSchema.parse(input);
    const activeState = await this.findProviderState(registration.provider.provider_id);
    const evaluation = this.evaluate(registration, activeState?.activeRegistrationVersion);
    const staleRegistration = activeState !== null && registration.registration_version <= activeState.activeRegistrationVersion;

    let [stored] = staleRegistration
      ? await this.db
        .insert(schema.providerRegistrations)
        .values({
          id: registration.id,
          catalogId: registration.catalog_id,
          providerId: registration.provider.provider_id,
          registrationVersion: registration.registration_version,
          status: evaluation.status,
          registration: registration as unknown as Record<string, unknown>,
          result: evaluation as unknown as Record<string, unknown>,
          sourceIp: meta.sourceIp ?? null,
          userAgent: meta.userAgent ?? null,
        })
        .onConflictDoNothing()
        .returning()
      : await this.db
        .insert(schema.providerRegistrations)
        .values({
          id: registration.id,
          catalogId: registration.catalog_id,
          providerId: registration.provider.provider_id,
          registrationVersion: registration.registration_version,
          status: evaluation.status,
          registration: registration as unknown as Record<string, unknown>,
          result: evaluation as unknown as Record<string, unknown>,
          sourceIp: meta.sourceIp ?? null,
          userAgent: meta.userAgent ?? null,
        })
        .onConflictDoUpdate({
          target: [
            schema.providerRegistrations.catalogId,
            schema.providerRegistrations.providerId,
            schema.providerRegistrations.registrationVersion,
          ],
          set: {
            status: evaluation.status,
            result: evaluation as unknown as Record<string, unknown>,
            sourceIp: meta.sourceIp ?? null,
            userAgent: meta.userAgent ?? null,
            updatedAt: new Date(),
          },
        })
        .returning();

    if (!stored && staleRegistration) {
      [stored] = await this.db
        .select()
        .from(schema.providerRegistrations)
        .where(and(
          eq(schema.providerRegistrations.catalogId, registration.catalog_id),
          eq(schema.providerRegistrations.providerId, registration.provider.provider_id),
          eq(schema.providerRegistrations.registrationVersion, registration.registration_version),
        ))
        .limit(1);
    }

    if (!stored) throw new AppError('internal_error', 'Failed to persist provider registration', 500);

    if (this.shouldActivate(evaluation, activeState?.activeRegistrationVersion, registration.registration_version)) {
      const matches = validDeclarationMatches(
        registration,
        this.scenario.objectContracts(),
        this.scenario.providerSyncCapabilities?.() ?? [],
      );

      await this.db
        .insert(schema.providerContractStates)
        .values({
          id: newId('pstate'),
          catalogId: registration.catalog_id,
          providerId: registration.provider.provider_id,
          activeRegistrationId: stored.id,
          activeRegistrationVersion: registration.registration_version,
          status: 'active',
          declaredObjectTypes: [],
          declaredPacks: [],
          guaranteedFields: unique(matches.flatMap((match) => match.declaration.guaranteed_fields)),
        })
        .onConflictDoUpdate({
          target: [schema.providerContractStates.catalogId, schema.providerContractStates.providerId],
          set: {
            activeRegistrationId: stored.id,
            activeRegistrationVersion: registration.registration_version,
            status: 'active',
            declaredObjectTypes: [],
            declaredPacks: [],
            guaranteedFields: unique(matches.flatMap((match) => match.declaration.guaranteed_fields)),
            updatedAt: new Date(),
          },
        });
    }

    return evaluation;
  }

  async getProvider(providerId: string) {
    const state = await this.findProviderState(providerId);
    if (!state) throw new AppError('not_found', `Provider ${providerId} is not registered`, 404);

    const [registration] = await this.db
      .select()
      .from(schema.providerRegistrations)
      .where(eq(schema.providerRegistrations.id, state.activeRegistrationId))
      .limit(1);

    const entryRows = await this.db
      .select({
        entryStatus: schema.catalogEntries.entryStatus,
        projection: schema.catalogEntries.searchProjection,
      })
      .from(schema.catalogEntries)
      .where(and(
        eq(schema.catalogEntries.catalogId, this.config.CATALOG_ID),
        eq(schema.catalogEntries.providerId, providerId),
      ));

    return {
      provider_id: providerId,
      catalog_id: state.catalogId,
      status: state.status,
      active_registration_version: state.activeRegistrationVersion,
      declared_packs: state.declaredPacks,
      guaranteed_fields: state.guaranteedFields,
      registration: registration?.registration ?? null,
      catalog_quality: summarizeCatalogProviderQuality(entryRows.map((row) => ({
        entryStatus: row.entryStatus,
        projection: asProjection(row.projection),
      }))),
      updated_at: state.updatedAt.toISOString(),
    };
  }

  async listRegistrations(providerId: string) {
    return this.db
      .select()
      .from(schema.providerRegistrations)
      .where(and(
        eq(schema.providerRegistrations.catalogId, this.config.CATALOG_ID),
        eq(schema.providerRegistrations.providerId, providerId),
      ))
      .orderBy(desc(schema.providerRegistrations.registrationVersion));
  }

  async findProviderState(providerId: string) {
    const [state] = await this.db
      .select()
      .from(schema.providerContractStates)
      .where(and(
        eq(schema.providerContractStates.catalogId, this.config.CATALOG_ID),
        eq(schema.providerContractStates.providerId, providerId),
      ))
      .limit(1);

    return state ?? null;
  }

  private evaluate(registration: ProviderRegistration, activeVersion?: number): RegistrationResult {
    const warnings: string[] = [];
    const missingRequiredFields: string[] = [];
    const blockingErrors: string[] = [];
    const selectedSyncCapabilities: SelectedSyncCapability[] = [];
    const catalogSyncCapabilities = this.scenario.providerSyncCapabilities?.() ?? [];

    if (registration.catalog_id !== this.config.CATALOG_ID) {
      return {
        ocp_version: '1.0',
        kind: 'RegistrationResult',
        id: newId('regres'),
        catalog_id: this.config.CATALOG_ID,
        provider_id: registration.provider.provider_id,
        status: 'rejected',
        matched_object_contract_count: 0,
        effective_registration_version: activeVersion,
        missing_required_fields: [],
        warnings: [`Registration catalog_id ${registration.catalog_id} does not match ${this.config.CATALOG_ID}`],
        message: 'Registration rejected.',
      };
    }

    if (activeVersion !== undefined && registration.registration_version <= activeVersion) {
      return {
        ocp_version: '1.0',
        kind: 'RegistrationResult',
        id: newId('regres'),
        catalog_id: registration.catalog_id,
        provider_id: registration.provider.provider_id,
        status: 'accepted_limited',
        matched_object_contract_count: 0,
        effective_registration_version: activeVersion,
        missing_required_fields: [],
        warnings: [`registration_version ${registration.registration_version} is not newer than active version ${activeVersion}`],
        message: 'Registration recorded, but the active provider contract was not changed.',
      };
    }

    for (const declaration of registration.object_declarations) {
      const declarationMatches = matchDeclarationToContracts(
        declaration,
        this.scenario.objectContracts(),
        catalogSyncCapabilities,
      );

      if (declarationMatches.matches.length === 0) {
        warnings.push(...declarationMatches.warnings);
        blockingErrors.push(...declarationMatches.errors);
        missingRequiredFields.push(...declarationMatches.missingRequiredFields);
        continue;
      }

      warnings.push(...declarationMatches.warnings);
      selectedSyncCapabilities.push(...declarationMatches.matches.map((match) => match.selectedSyncCapability));
    }

    const matchedObjectContractCount = registration.object_declarations.reduce((count, declaration) => (
      count + matchDeclarationToContracts(declaration, this.scenario.objectContracts(), catalogSyncCapabilities).matches.length
    ), 0);
    const selectedSyncCapability = resolveSelectedSyncCapability(selectedSyncCapabilities, warnings);
    const status = matchedObjectContractCount === 0
      ? 'rejected'
      : warnings.length > 0 || blockingErrors.length > 0
        ? 'accepted_limited'
        : 'accepted_full';

    return {
      ocp_version: '1.0',
      kind: 'RegistrationResult',
      id: newId('regres'),
      catalog_id: registration.catalog_id,
      provider_id: registration.provider.provider_id,
      status,
      matched_object_contract_count: matchedObjectContractCount,
      effective_registration_version: status === 'rejected' ? activeVersion : registration.registration_version,
      selected_sync_capability: status === 'rejected' ? undefined : selectedSyncCapability,
      missing_required_fields: unique(missingRequiredFields),
      warnings: unique([...warnings, ...blockingErrors]),
      message: status === 'rejected'
        ? 'Registration rejected.'
        : 'Registration accepted and provider contract state updated.',
    };
  }

  private shouldActivate(result: RegistrationResult, activeVersion: number | undefined, newVersion: number) {
    if (result.status === 'rejected') return false;
    if (result.matched_object_contract_count === 0) return false;
    return activeVersion === undefined || newVersion > activeVersion;
  }
}

function evaluateDeclaration(
  contract: ObjectContract,
  declaration: ProviderRegistration['object_declarations'][number],
  catalogSyncCapabilities: SyncCapability[],
) {
  const errors: string[] = [];
  const guaranteedFields = new Set(declaration.guaranteed_fields);
  const missingRequiredFields: string[] = [];

  for (const requirement of contract.required_fields) {
    if (typeof requirement === 'string') {
      if (!guaranteedFields.has(requirement)) {
        errors.push(`Missing required field_ref: ${requirement}`);
        missingRequiredFields.push(requirement);
      }
      continue;
    }

    if (!requirement.some((fieldRef) => guaranteedFields.has(fieldRef))) {
      errors.push(`Missing required field_ref group: ${requirement.join(' | ')}`);
      missingRequiredFields.push(...requirement);
    }
  }

  const selectedSyncCapability = negotiateSyncCapability(catalogSyncCapabilities, declaration);
  if (!selectedSyncCapability) {
    errors.push('No mutually supported sync capability for object contract.');
    return { errors, missingRequiredFields };
  }

  const capability = catalogSyncCapabilities.find((candidate) => candidate.capability_id === selectedSyncCapability.capability_id);
  if (!capability) {
    errors.push(`Selected sync capability ${selectedSyncCapability.capability_id} is not published by the catalog.`);
    return { errors, missingRequiredFields };
  }

  for (const requiredEndpointField of capability?.endpoint_contract?.required_endpoint_fields ?? []) {
    if (!(requiredEndpointField in declaration.sync.provider_endpoints)) {
      errors.push(`Missing provider endpoint: ${requiredEndpointField} for capability ${capability.capability_id}`);
    }
  }

  return { errors, selectedSyncCapability, missingRequiredFields };
}

function validDeclarationMatches(
  registration: ProviderRegistration,
  contracts: ObjectContract[],
  catalogSyncCapabilities: SyncCapability[],
) {
  return registration.object_declarations.flatMap((declaration) => (
    matchDeclarationToContracts(declaration, contracts, catalogSyncCapabilities).matches
  ));
}

function unique<T>(values: T[]) {
  return [...new Set(values)];
}

function negotiateSyncCapability(
  catalogSyncCapabilities: SyncCapability[],
  declaration: ProviderRegistration['object_declarations'][number],
): SelectedSyncCapability | null {
  const catalogCapabilityIds = new Set(catalogSyncCapabilities.map((capability) => capability.capability_id));
  const preferredMatches = declaration.sync.preferred_capabilities.filter((capabilityId) => catalogCapabilityIds.has(capabilityId));
  if (preferredMatches.length > 0) {
    return {
      capability_id: preferredMatches[0],
      reason: 'provider_preferred_and_supported_by_catalog',
    };
  }

  const fallbackMatches = declaration.sync.avoid_capabilities_unless_necessary.filter((capabilityId) => catalogCapabilityIds.has(capabilityId));
  if (fallbackMatches.length > 0) {
    return {
      capability_id: fallbackMatches[0],
      reason: 'provider_fallback_capability_selected',
    };
  }

  return null;
}

function resolveSelectedSyncCapability(
  selectedSyncCapabilities: SelectedSyncCapability[],
  warnings: string[],
): SelectedSyncCapability | undefined {
  if (selectedSyncCapabilities.length === 0) return undefined;

  const uniqueSelections = unique(selectedSyncCapabilities.map((capability) => `${capability.capability_id}:${capability.reason}`));
  if (uniqueSelections.length > 1) {
    warnings.push('Multiple object declarations selected different sync capabilities; returning the first negotiated capability.');
  }

  return selectedSyncCapabilities[0];
}

function matchDeclarationToContracts(
  declaration: ProviderRegistration['object_declarations'][number],
  contracts: ObjectContract[],
  catalogSyncCapabilities: SyncCapability[],
) {
  const matches: DeclarationMatch[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];
  const missingRequiredFields: string[] = [];

  for (const contract of contracts) {
    const evaluation = evaluateDeclaration(contract, declaration, catalogSyncCapabilities);
    missingRequiredFields.push(...(evaluation.missingRequiredFields ?? []));
    if (evaluation.errors.length === 0 && evaluation.selectedSyncCapability) {
      matches.push({
        contract,
        declaration,
        selectedSyncCapability: evaluation.selectedSyncCapability,
      });
    }
  }

  if (matches.length === 0) {
    errors.push('Declaration did not match any object contract by required fields.');
  } else if (matches.length > 1) {
    warnings.push('One provider declaration matched multiple object contracts.');
  }

  return { matches, warnings, errors, missingRequiredFields: unique(missingRequiredFields) };
}

function summarizeCatalogProviderQuality(rows: Array<{
  entryStatus: string;
  projection: Record<string, unknown>;
}>) {
  const summary = {
    object_count: rows.length,
    active_entry_count: 0,
    rich_entry_count: 0,
    standard_entry_count: 0,
    basic_entry_count: 0,
    out_of_stock_count: 0,
    missing_image_count: 0,
    missing_product_url_count: 0,
  };

  for (const row of rows) {
    if (row.entryStatus === 'active') summary.active_entry_count += 1;

    const qualityTier = stringValue(row.projection.quality_tier);
    if (qualityTier === 'rich') summary.rich_entry_count += 1;
    else if (qualityTier === 'standard') summary.standard_entry_count += 1;
    else summary.basic_entry_count += 1;

    if (stringValue(row.projection.availability_status) === 'out_of_stock') summary.out_of_stock_count += 1;
    if (row.projection.has_image !== true) summary.missing_image_count += 1;
    if (row.projection.has_product_url !== true) summary.missing_product_url_count += 1;
  }

  return summary;
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value : undefined;
}

export const __registrationServiceTestOnly = {
  summarizeCatalogProviderQuality,
};

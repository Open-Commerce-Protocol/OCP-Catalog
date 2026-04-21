import type { Db } from '@ocp-catalog/db';
import { schema } from '@ocp-catalog/db';
import {
  providerRegistrationSchema,
  type ObjectContract,
  type ProviderRegistration,
  type RegistrationResult,
} from '@ocp-catalog/ocp-schema';
import { AppError, newId } from '@ocp-catalog/shared';
import { and, desc, eq } from 'drizzle-orm';
import type { AppConfig } from '@ocp-catalog/config';
import type { CatalogScenarioModule } from './scenario';

export type RequestMeta = {
  sourceIp?: string | null;
  userAgent?: string | null;
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
      const declarations = validDeclarations(registration, this.scenario.objectContracts());

      await this.db
        .insert(schema.providerContractStates)
        .values({
          id: newId('pstate'),
          catalogId: registration.catalog_id,
          providerId: registration.provider.provider_id,
          activeRegistrationId: stored.id,
          activeRegistrationVersion: registration.registration_version,
          status: 'active',
          declaredObjectTypes: unique(declarations.map((declaration) => declaration.object_type)),
          declaredPacks: unique(declarations.flatMap((declaration) => declaration.provided_packs)),
          guaranteedFields: unique(declarations.flatMap((declaration) => declaration.guaranteed_fields)),
        })
        .onConflictDoUpdate({
          target: [schema.providerContractStates.catalogId, schema.providerContractStates.providerId],
          set: {
            activeRegistrationId: stored.id,
            activeRegistrationVersion: registration.registration_version,
            status: 'active',
            declaredObjectTypes: unique(declarations.map((declaration) => declaration.object_type)),
            declaredPacks: unique(declarations.flatMap((declaration) => declaration.provided_packs)),
            guaranteedFields: unique(declarations.flatMap((declaration) => declaration.guaranteed_fields)),
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

    return {
      provider_id: providerId,
      catalog_id: state.catalogId,
      status: state.status,
      active_registration_version: state.activeRegistrationVersion,
      declared_object_types: state.declaredObjectTypes,
      declared_packs: state.declaredPacks,
      guaranteed_fields: state.guaranteedFields,
      registration: registration?.registration ?? null,
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
    const matchedContractIds: string[] = [];
    const blockingErrors: string[] = [];

    if (registration.catalog_id !== this.config.CATALOG_ID) {
      return {
        ocp_version: '1.0',
        kind: 'RegistrationResult',
        id: newId('regres'),
        catalog_id: this.config.CATALOG_ID,
        provider_id: registration.provider.provider_id,
        status: 'rejected',
        matched_contract_ids: [],
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
        matched_contract_ids: [],
        effective_registration_version: activeVersion,
        missing_required_fields: [],
        warnings: [`registration_version ${registration.registration_version} is not newer than active version ${activeVersion}`],
        message: 'Registration recorded, but the active provider contract was not changed.',
      };
    }

    for (const declaration of registration.object_declarations) {
      const contract = this.scenario.objectContracts().find((candidate) => candidate.object_type === declaration.object_type);
      if (!contract) {
        warnings.push(`Unsupported object_type: ${declaration.object_type}`);
        continue;
      }

      const declarationErrors = validateDeclaration(contract, declaration);
      if (declarationErrors.length > 0) {
        blockingErrors.push(...declarationErrors);
        missingRequiredFields.push(...declarationErrors.filter((error) => error.startsWith('Missing required field_ref: ')));
        continue;
      }

      matchedContractIds.push(contract.contract_id);
    }

    const uniqueMatchedContractIds = unique(matchedContractIds);
    const status = uniqueMatchedContractIds.length === 0
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
      matched_contract_ids: uniqueMatchedContractIds,
      effective_registration_version: status === 'rejected' ? activeVersion : registration.registration_version,
      missing_required_fields: unique(missingRequiredFields),
      warnings: unique([...warnings, ...blockingErrors]),
      message: status === 'rejected'
        ? 'Registration rejected.'
        : 'Registration accepted and provider contract state updated.',
    };
  }

  private shouldActivate(result: RegistrationResult, activeVersion: number | undefined, newVersion: number) {
    if (result.status === 'rejected') return false;
    if (result.matched_contract_ids.length === 0) return false;
    return activeVersion === undefined || newVersion > activeVersion;
  }
}

function validateDeclaration(contract: ObjectContract, declaration: ProviderRegistration['object_declarations'][number]) {
  const errors: string[] = [];
  const providedPacks = new Set(declaration.provided_packs);
  const guaranteedFields = new Set(declaration.guaranteed_fields);

  for (const requiredPack of contract.required_packs) {
    if (!providedPacks.has(requiredPack)) errors.push(`Missing required pack: ${requiredPack}`);
  }

  for (const rule of contract.field_rules.filter((fieldRule) => fieldRule.requirement === 'required')) {
    if (!guaranteedFields.has(rule.field_ref)) errors.push(`Missing required field_ref: ${rule.field_ref}`);
  }

  if (!contract.registration_modes.includes(declaration.delivery.mode)) {
    errors.push(`Unsupported delivery mode for ${declaration.object_type}: ${declaration.delivery.mode}`);
  }

  return errors;
}

function validDeclarations(registration: ProviderRegistration, contracts: ObjectContract[]) {
  return registration.object_declarations.filter((declaration) => {
    const contract = contracts.find((candidate) => candidate.object_type === declaration.object_type);
    return contract ? validateDeclaration(contract, declaration).length === 0 : false;
  });
}

function unique<T>(values: T[]) {
  return [...new Set(values)];
}

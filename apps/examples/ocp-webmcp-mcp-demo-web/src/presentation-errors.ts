export type UserFacingError = {
  userMessage: string;
  diagnosticMessage: string;
};

const genericUserMessage = '服务暂时不可用，请稍后再试。';
const dataSourceUserMessage = '部分数据源暂时不可用，请稍后再试。';

export function toUserFacingError(error: unknown): UserFacingError {
  const diagnosticMessage = error instanceof Error ? error.message : String(error);
  return {
    userMessage: classifyUserMessage(diagnosticMessage),
    diagnosticMessage,
  };
}

function classifyUserMessage(message: string) {
  if (isCatalogManifestFailure(message)) return dataSourceUserMessage;
  if (isInfrastructureFailure(message)) return genericUserMessage;
  return message || genericUserMessage;
}

function isCatalogManifestFailure(message: string) {
  return /^Catalog manifest fetch failed: HTTP \d{3}/.test(message)
    || /Catalog manifest fetch timed out/.test(message)
    || /all \d+ Catalog manifests failed to load/.test(message);
}

function isInfrastructureFailure(message: string) {
  return /HTTP (?:5\d\d|0)\b/.test(message)
    || /failed to fetch/i.test(message)
    || /network/i.test(message)
    || /timed out/i.test(message)
    || /transport/i.test(message)
    || /Bad Gateway/i.test(message);
}

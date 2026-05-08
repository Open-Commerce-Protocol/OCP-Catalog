export const ocpUserDemoWebMcpManifest = {
  name: 'OCP User Demo',
  version: '0.1.0',
  tools: [
    'ocp.get_page_state',
    'ocp.submit_user_intent',
    'ocp.confirm_pending_catalog',
    'ocp.select_catalog_profile',
    'ocp.resolve_result_entry',
    'ocp.open_resolved_action',
  ],
} as const;

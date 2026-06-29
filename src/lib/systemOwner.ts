// Sentinel ownerId for the global, system-provided property-type catalog (corrected
// Approach A). System default ProjectType rows use this; supervisor-owned rows use the
// supervisor's User.id. It is a bare string, NOT a User FK — the app has no
// user.findMany, so a real system-user row would only add credentials to exclude.
export const SYSTEM_OWNER_ID = "__system__";

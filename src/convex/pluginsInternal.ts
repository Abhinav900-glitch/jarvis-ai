// This file is intentionally left empty.
//
// getPluginRowForSkill now lives in plugins.ts next to applySkill, so this
// module no longer needs to export anything. A previous attempt split the
// helper into its own file so the generated internal reference would exist, but
// Convex generated the type side (api.d.ts) without the runtime module, so
// the internal.pluginsInternal call never resolved to anything callable.

const moduleName = getModuleName();
const dependency = await import(moduleName);
const loaded = eval("require(moduleName)");

export { dependency, loaded };

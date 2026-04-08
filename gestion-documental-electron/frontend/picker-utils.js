(() => {
  function getElement(target) {
    return typeof target === "string" ? document.getElementById(target) : target;
  }

  function bindPickerTrigger(buttonTarget, inputTarget) {
    const button = getElement(buttonTarget);
    const input = getElement(inputTarget);

    if (!button || !input) {
      return;
    }

    button.addEventListener("click", () => input.click());
  }

  function getBaseName(fileName = "") {
    const lastDotIndex = fileName.lastIndexOf(".");
    return lastDotIndex > 0 ? fileName.slice(0, lastDotIndex) : fileName;
  }

  function normalizePath(value = "") {
    return String(value).replace(/\//g, "\\");
  }

  function deriveFolderSelection(file) {
    if (!file) {
      return null;
    }

    const absoluteFilePath = normalizePath(file.path || "");
    const relativeFilePath = normalizePath(
      file.webkitRelativePath || file.name || "",
    );
    const folderPath = absoluteFilePath
      ? absoluteFilePath
          .slice(0, absoluteFilePath.length - relativeFilePath.length)
          .replace(/[\\/]$/, "")
      : "";

    return {
      absolutePath: folderPath,
      label: folderPath || "Carpeta seleccionada",
      suggestedName:
        file.webkitRelativePath?.split("/")[0] ||
        folderPath.split(/[/\\]/).pop() ||
        "",
    };
  }

  function deriveFileSelection(file) {
    if (!file) {
      return null;
    }

    return {
      absolutePath: normalizePath(file.path || ""),
      label: file.name || "Archivo seleccionado",
      suggestedName: getBaseName(file.name || ""),
      fileName: file.name || "",
    };
  }

  function deriveRelativePath(absolutePath, rootAbsolutePath, fallbackName = "") {
    const normalizedAbsolutePath = normalizePath(absolutePath).toLowerCase();
    const normalizedRootPath = normalizePath(rootAbsolutePath).toLowerCase();

    if (
      normalizedAbsolutePath &&
      normalizedRootPath &&
      normalizedAbsolutePath.startsWith(`${normalizedRootPath}\\`)
    ) {
      return normalizePath(absolutePath).slice(normalizePath(rootAbsolutePath).length + 1);
    }

    return fallbackName || "";
  }

  window.pickerUtils = {
    bindPickerTrigger,
    deriveFolderSelection,
    deriveFileSelection,
    deriveRelativePath,
    getBaseName,
    normalizePath,
  };
})();

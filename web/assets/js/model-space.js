const frame = document.querySelector("#model-space-frame");
const loading = document.querySelector("#explorer-loading");
const error = document.querySelector("#explorer-error");
let loaded = false;

function finishLoading() {
  loaded = true;
  frame.classList.add("ready");
  loading.classList.add("done");
}

frame.addEventListener("load", () => {
  try {
    const doc = frame.contentDocument;
    if (!doc?.head || !doc.body) throw new Error("Embedded document is unavailable");

    doc.title = "Arch Form — Model Space";
    doc.body.classList.add("arch-form-embedded");

    if (!doc.querySelector("#arch-form-embedded-theme")) {
      const theme = doc.createElement("link");
      theme.id = "arch-form-embedded-theme";
      theme.rel = "stylesheet";
      theme.href = "/arch-form-web/web/assets/css/model-space-legacy.css?v=20260914";
      theme.addEventListener("load", finishLoading, { once: true });
      doc.head.append(theme);
      window.setTimeout(finishLoading, 1000);
    } else {
      finishLoading();
    }
  } catch (cause) {
    console.error("Could not integrate model-space page", cause);
    error.hidden = false;
    loading.classList.add("done");
  }
});

// The iframe carries no src in the markup: this module is imported the first
// time the Model Latent tab is opened, so the heavy viewer only loads on demand
// and then stays alive for the rest of the session.
frame.src = "/arch-form-web/model-latent-analysis/web/dist/";

window.setTimeout(() => {
  if (!loaded) {
    error.hidden = false;
    loading.classList.add("done");
  }
}, 30000);

# Arch Form web

The static website combines three primary views:

- `index.html`: ranked competition browser with critique distributions
- `analysis.html`: interactive cross-competition jury analysis
- `model-space.html`: integrated 3D form-space explorer from `../model-latent-analysis`
- `project.html`: individual 3D model and spatial critique review

## Run

From the repository root:

```bash
./web/scripts/serve.sh
```

Open <http://localhost:4173/arch-form-web/web/>.

The latent-space source, compiled explorer, Rhino models, and ONNX assets are
bundled under `../model-latent-analysis`; the website no longer depends on the
separate `~/arch-form` checkout at runtime.

## Layout

```text
web/
├── assets/
│   ├── css/                 page and embedded-explorer themes
│   ├── js/                  page controllers and Three.js viewer
│   └── model-references/    generated isometric thumbnails (gitignored)
├── scripts/                 local server and reference capture utilities
├── tools/                   calibrated point-cloud reference renderer
└── *.html                   user-facing pages
```

The review data comes from `../data/extracted/designs`, and dashboard CSVs come
from `../jury-text-analysis/results`.

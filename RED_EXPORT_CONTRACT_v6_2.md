# RED -> Visualisation Studio v6.2 future export hooks

The Studio now supports the following presentation-side behaviour without changing engineering geometry.

## Revegetation footprint

Preferred future RED export:

```json
{
  "id": "revegetation-...",
  "label": "Revegetation area",
  "role": "revegetation_area",
  "layer_group": "revegetation",
  "positions": [...],
  "indices": [...],
  "metadata": {
    "presentation_only": false,
    "source": "RED revegetation polygon"
  }
}
```

The Studio detects `role=revegetation`, `role=revegetation_area`, `layer_group=revegetation`, or an id/label containing `reveg`.
If found, illustrative establishment vegetation is generated only over that footprint. If not found, v6.2 retains the current design-surface fallback and identifies that fallback in the UI.

## Rock presentation

The Studio can currently add presentation-only clasts over exported rock meshes. A better future RED export would also include nominal rock-size metadata (for example D50 / D100 or adopted class) so displayed clast scale can be tied to the actual design rather than a generic visual heuristic.

## Water extent

v6.2 derives a presentation water mask by clipping the exported existing terrain against the nominated water RL. A future explicit water/channel polygon could be exported if tighter project-specific control is needed.

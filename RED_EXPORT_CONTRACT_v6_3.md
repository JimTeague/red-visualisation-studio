# RED Visualisation Studio v6.3 - proposed RED export hooks

## 1. Revegetation footprint

Recommended RED design/export role:

- `role`: `revegetation_area`
- `layer_group`: `revegetation`

The geometry should represent the actual revegetation treatment footprint rather than the complete earthworks design surface.

Useful future metadata:
- treatment name / ID
- vegetation character
- target planting density
- seed / tubestock / mixed treatment
- exclusion zones
- establishment notes

The Studio already detects `revegetation_area`, `revegetation`, or a `revegetation` layer group and uses it as the presentation vegetation source.

## 2. Water presentation footprint

Recommended optional RED export role:

- `role`: `water_extent`
- `layer_group`: `water_extent`

This should be an XY footprint only. The Studio sets its displayed Z to the user-selected water RL, so the footprint does not become an engineering water-surface prediction.

This can be useful where a user knows the channel/waterbody presentation extent and terrain clipping alone is visually too broad.

## Engineering boundary

Both hooks are optional visualisation inputs. They must remain separate from hydraulic model results unless explicitly exported from a hydraulic result workflow with appropriate provenance.

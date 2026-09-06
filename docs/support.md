# Supported and unsupported features

ShapeShifter is an Android VectorDrawable / AnimatedVectorDrawable editor. This matrix is the source of truth.

## Android VectorDrawable

| Feature                           | Import | Preview  | Export                  |
| --------------------------------- | ------ | -------- | ----------------------- |
| Paths, groups, clip-paths         | Yes    | Yes      | Yes                     |
| Viewport vs intrinsic dp          | Yes    | Yes      | Yes                     |
| Solid fill/stroke, trim, fillType | Yes    | Yes      | Yes                     |
| Linear/radial aapt gradients      | Yes    | Yes      | Yes (viewport space)    |
| Tint, tintMode, autoMirrored      | Yes    | Metadata | Yes                     |
| Hidden layers                     | Yes    | Yes      | Omitted with diagnostic |

## AnimatedVectorDrawable

| Feature                                                | Preview                                                      | Export                              |
| ------------------------------------------------------ | ------------------------------------------------------------ | ----------------------------------- |
| pathData, color, alpha, stroke, trim, transforms       | Yes                                                          | Yes                                 |
| Named Android interpolators including FAST_OUT_SLOW_IN | Yes                                                          | Named platform resource             |
| Custom cubic-bezier                                    | Yes                                                          | `pathInterpolator` resource         |
| Incompatible path morphs                               | Held at start                                                | Blocked (`INCOMPATIBLE_PATH_MORPH`) |
| AVD ZIP import                                         | Yes (uncompressed ShapeShifter ZIP or drawable+animator XML) | Yes                                 | Yes |

## Experimental (not production Android)

Animated SVG, CSS keyframes, spritesheet, Lottie, and PDF are labeled experimental. They may drop clips, flatten gradients, or export a single layer.

## Disabled

Destructive Boolean union/subtract/intersect/exclude until a curve-capable kernel exists.

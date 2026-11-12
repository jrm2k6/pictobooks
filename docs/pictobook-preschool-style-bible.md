# Pictobook Preschool Style Bible

Style pack: `pictobook-preschool-v0.1`

Style bible revision: `v0.2`

Last updated: 2026-10-28

This document defines the initial house style for Pictobook coloring-book generation. It is meant to be specific enough to drive prompts, QA checks, character sheets, and print output.

## Style Intent

Create simple, friendly, classic kids coloring-book pages inspired by family photos. The output should feel like one consistent children's coloring book, not a collection of unrelated AI images.

The style should prioritize:

- clarity over realism
- consistency over exact photo fidelity
- large colorable shapes over decorative detail
- recognizable identity cues over detailed likeness
- clean print output over artistic texture

## Format

- Page size: A4 portrait.
- Pixel target: 2480 x 3508 px.
- Print target: 300 DPI equivalent.
- Background: pure white.
- Artwork: pure black line art.
- Safe margin: keep important artwork away from the outer edge.
- Final artwork should contain no printed captions, titles, page numbers, borders, or nameplates for MVP.

## Line Art Rules

- Use medium-bold, smooth, confident outlines.
- Use mostly continuous closed shapes.
- Use a consistent line weight across all pages.
- Avoid thin sketchy marks.
- Avoid scratch lines.
- Avoid cross-hatching.
- Avoid gray shading.
- Avoid gradients.
- Avoid texture fills.
- Avoid photographic shadow interpretation.
- Avoid tiny enclosed regions that would be frustrating to color.

## Detail Density

Target: classic kids coloring-book complexity, kept simple enough for preschool-aged children.

Each page should have:

- one clear main idea
- one to three main subjects preferred; four or more are acceptable when the composition keeps faces, silhouettes, and actions readable
- sparse background elements
- large empty areas
- simple clothing details only when needed for identity
- simplified hands, faces, hair, and pet fur

Localized complexity is acceptable when it preserves identity or scene meaning. Examples include a simple tattoo, emblem, toy wrapping, vehicle control, or a small number of wheel spokes. Keep these details contained to one area and surround them with larger coloring shapes.

Distributed complexity is not acceptable. Regenerate when small regions, repeated patterns, or narrow bands are spread across the page and make most of the composition difficult to color.

Each page should avoid:

- crowded scenes
- realistic wrinkles
- individual hair strands
- complex fabric patterns
- grass blade texture
- brick, tile, wallpaper, or furniture texture unless simplified
- background people unless essential

## Character Rules

The first MVP does not require recurring-character identity resolution or character sheets.

Each page should preserve visible identity cues from the source photo itself. The goal is for the generated page to feel inspired by that photo while staying inside the Pictobook house style.

Characters should be simplified into a cartoon representation. Preserve visible cues such as:

- face shape
- hairstyle or pet silhouette
- glasses
- distinctive accessories
- major clothing silhouette
- important pet markings

Do not try to preserve:

- exact facial texture
- precise age lines
- photographic lighting
- tiny clothing logos
- detailed fur texture
- realistic teeth

In multi-person photos, identity cues must be scoped to individual subjects. Avoid flat cue lists that make it unclear which person has which features.

## Face And Expression Rules

- Faces should be friendly, expressive, and simple.
- Eyes should be clear and age-appropriate.
- Mouths should be simple, with minimal teeth detail.
- Noses should be minimal.
- Avoid uncanny expressions.
- Avoid over-rendered eyelashes, wrinkles, or facial shadows.
- Preserve identity mostly through stable shape, expression, hair, glasses, and accessories.
- Favor slightly likeness-oriented cartoon faces over generic dot-and-smile faces.

## Background Rules

Backgrounds should support the scene without taking over.

Background restraint does not require an empty page. A background passes when its shapes are simplified, its visual weight remains secondary, and it provides useful scene context without competing with the main subject.

Keep:

- one or two simplified setting cues
- large simple shapes
- recognizable context, such as beach waves, birthday cake, sofa, tree, suitcase, or pet bed

Remove or simplify:

- crowds
- cluttered rooms
- busy shelves
- complex landscapes
- small toys scattered everywhere
- realistic grass, sand, water, or fabric texture

## Source Photo Reinterpretation

The source photo is evidence, not a canvas to trace.

The generated page may reinterpret:

- pose
- background
- object placement
- framing
- scene density

The generated page should preserve:

- main subject or subjects
- key action or idea
- important identity cues
- important object cues
- color metadata as semantic information, even though output is black-and-white

## Character Sheet Requirements

Character sheets are a post-MVP consistency upgrade, not a requirement for the first MVP.

If introduced later, each character sheet should include:

- one front-facing head-and-shoulders portrait
- one simple full-body standing pose
- two expression variants
- identity metadata
- source photo references

Character sheets must use the same line style as final pages:

- pure black on white
- thick smooth outlines
- simple preschool cartoon rendering
- no gray, shading, texture, or hatching

## Subject Classification

Uploaded photos may contain both recurring subjects and incidental subjects.

The first MVP should not attempt full automatic recurring-subject detection across the uploaded photo set. Instead, photo analysis should classify subjects within each photo by centrality.

Primary subjects are:

- central people or pets in the photo
- subjects involved in the main action
- subjects whose visible cues should be preserved in the generated page

Incidental subjects are:

- background people
- strangers in vacation photos
- people who appear once and are not central to the scene
- small distant figures

Family group photos are allowed, but the page planner should simplify them when needed. A group photo can become a page with only the most important primary subjects plus one or two simple context cues.

When every person is essential to the meaning of a group photo, keep the full group. Prefer closer framing and simplified clothing, hands, and scenery rather than removing required people.

## Character Sheet Approval

Character sheet approval is not part of the first MVP because character sheets are deferred.

If character sheets are introduced later, manual approval should be the default at first because a bad character sheet would contaminate every generated page that uses it.

## Prompt Template

Use this as the base prompt for final page generation:

```text
Create a simple preschool coloring-book page in the Pictobook house style.

Format:
- A4 portrait composition
- pure black line art on pure white background
- thick smooth continuous outlines
- large closed areas for coloring
- sparse background
- no captions, titles, borders, page numbers, or text

Scene:
{{scene_description}}

Subjects:
{{subject_descriptions}}

Preserve these identity cues:
{{identity_cues}}

Preserve these key objects and semantic color cues:
{{object_and_color_metadata}}

Use the provided style references as the canonical Pictobook preschool style.
Reinterpret the source photo into a cleaner, simpler coloring page if needed.
```

## Negative Prompt

```text
photorealistic, grayscale, gray shading, shadows, gradients, cross-hatching, stippling, texture, sketch marks, messy lines, thin lines, tiny details, crowded background, clutter, realistic hair strands, realistic fur texture, clothing logos, text, letters, captions, page numbers, border, watermark, scary face, uncanny face, distorted hands, distorted eyes, extra fingers, malformed limbs
```

## QA Rubric

Each generated page should be scored from `0` to `1` on the following dimensions.

### Style Consistency

Does the page look like it belongs to the same Pictobook preschool coloring book?

Automatic-approval target: `0.68` or higher, provided the same Candidate passes Print QA and no applicable dimension is below `0.55`.

### Print Cleanliness

Is the output pure black-and-white, with no gray shading, texture, or low-contrast marks?

Pass target: `0.98` or higher.

### Preschool Simplicity

Are the shapes large, clear, and simple enough for a young child to color?

Pass target: `0.68` or higher.

### Character Consistency

Does the page preserve the visible subject cues from the source photo without becoming overly detailed?

Pass target: `0.68` or higher when a person or animal character is present. Mark this dimension not applicable for object-only and landscape pages.

### Scene Clarity

Is the key idea from the source photo clear after simplification?

Pass target: `0.68` or higher.

### Background Restraint

Does the background support the page without becoming busy?

Pass target: `0.68` or higher.

### Anatomy And Friendliness

Are faces, hands, limbs, and pets friendly, non-scary, and free of obvious distortions?

Pass target: `0.68` or higher when a person or animal character is present. Mark character-specific anatomy and facial dimensions not applicable when no character is present.

## Automated Decision Bands

- `0.68` or higher: automatically approved when that same Candidate passes Print QA and no applicable dimension is below `0.55`.
- `0.60` to below `0.68`: repair or request human review depending on improvement history.
- Below `0.60`: regenerate from the source photo.
- Any critical anatomy, printed text, grayscale, watermark, or print-fitness defect blocks automatic readiness regardless of average score.

Not-applicable dimensions are excluded from the average. Do not assign a neutral `0.5` to pages without faces or characters; doing so unfairly penalizes otherwise valid vehicle, object, and landscape pages.

## Automatic Rejection Conditions

Reject and regenerate if any of these are true:

- gray shading or texture is visible
- page contains text, letters, watermark, caption, border, or page number
- subject has scary or uncanny face
- hands, eyes, limbs, or pet body are obviously malformed
- background is too cluttered
- line art is too thin, sketchy, or inconsistent
- page contains many tiny uncolorable regions
- visible subject cues from the source photo are missing or assigned to the wrong person
- image is not A4 portrait or has unsafe margins

## Repair Instructions

Common repair instructions:

- Simplify the background.
- Use thicker, smoother outlines.
- Remove gray shading and texture.
- Reduce clothing and hair detail.
- Increase large closed coloring areas.
- Preserve the subject's visible hairstyle, glasses, face shape, and body silhouette.
- Remove all text, numbers, watermarks, and borders.
- Make the face friendlier and simpler.
- Remove clutter and keep only the main subject plus one or two setting cues.

## Decisions Still Needed

- Exact safe margin for A4 pages.
- Target line thickness in pixels at 2480 x 3508.
- Maximum number of primary subjects per page for MVP.
- Whether character sheets become required after MVP.
- Whether SVG is required for MVP or post-MVP.
- Cover strategy.

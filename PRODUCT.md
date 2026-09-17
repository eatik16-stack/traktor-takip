# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary: eight production and quality staff at TAFE Manisa, one per station on the
post-roll-down line — RDC (Roll-Down Kontrol), RW-1 (1. Rework), RUN (Running Test),
RW-2 (2. Rework), OIL (Oil Flushing), PAINT (Boya / Touch-Up), FINAL (Final Kontrol),
PDI (Sevk Öncesi Muayene). Each sees only their own station screen; work reaches them
as a work order when the tractor's turn arrives.

Secondary: Emre Atik, Deputy Manager of Quality & Homologation, as system
administrator. He alone sees the plant-wide screens — live line map, all tractors, all
defect records, pending approvals, management report, and definitions.

Situation and job: staff stand at the tractor on the shop floor, open the app on a
phone or the station tablet, and record that a step started and finished, raise a
defect against the tractor, or close a rework. The administrator watches flow and
dwell time and releases tractors for dispatch.

## Product Purpose

Replaces an Excel workbook for tracking each tractor through the approval steps that
follow roll-down. It records, per tractor and per station, when work started and
finished, which defects were raised, where they were sent for rework, and who approved
the fix — so that station dwell time and first-time-through quality can be measured
from one input stream instead of reconstructed after the fact.

Success: a station operator records a step without leaving one screen, and the
administrator can answer "where is this tractor and how long has it been there" at any
moment without asking anyone.

## Positioning

The workflow is the product: a defect raised at a quality station opens a work order at
the named production station, and when that work is closed the tractor returns to the
station it came from, not to the start. Rework steps with nothing to do are skipped so
they do not inflate the measured time. A generic task tracker cannot express this
return-to-origin routing or the four-eyes rule that stops a person approving their own
rework.

## Operating Context

- Shop floor at the Manisa plant. Gloves are worn. Glare and direct sunlight occur.
- Staff work one-handed, standing next to the tractor.
- The environment is noisy: audible feedback is useless; confirmation must be visual
  and haptic.
- Devices in use, all three at once: a fixed tablet at each station, and staff's own
  Android phones and iPhones. iOS Safari has no built-in barcode reader and its home
  indicator consumes the bottom edge.
- Each person signs in with their own account and stays signed in for the shift, so
  sign-out is a rare action.
- Working hours Mon–Fri 08:00–18:00 with breaks at 10:15–10:30, 12:30–13:45 and
  15:30–15:45. All durations are computed inside these hours only.
- Tractors are identified by a 17-character chassis number read from a label barcode;
  the sale code (e.g. GX706F2) is read from the same label. No master list maps chassis
  to sale code, so the label is the only source.

## Capabilities and Constraints

- Static site: plain ES modules, no framework and no build step, served from GitHub
  Pages. Firebase Auth for sign-in and Cloud Firestore for data, with offline
  persistence. Access is gated per e-mail address and enforced server-side by
  firestore.rules.
- Roles: kontrol, rework, onay, operator, yonetim, admin, plus two that are never
  granted implicitly — hata_duzenle (edit or cancel someone else's defect record) and
  tam_onay (approve one's own rework).
- Step definitions, defect catalogue and lists are data, editable by the administrator;
  steps can be deactivated or deleted and are renumbered 1..N afterwards.
- The defect catalogue holds over 2000 real entries imported from the plant's Excel
  file. Chassis numbers, sale codes and station names in the system are real.
- Target step durations are deliberately zero until enough real data exists to compute
  averages.
- Every state change is written to an append-only audit log.
- Terminology is the plant's own and must not be translated or softened: roll-down,
  rework, sevke hazır, onay bekleyen, şasi, satış kodu, kabin anahtar no.

## Brand Commitments

Name: Traktör Takip. Turkish only — no second language is planned, so copy lives in the
code. Plant: TAFE Manisa. The interface addresses staff plainly and without jargon
beyond the plant's own vocabulary.

## Evidence on Hand

- Real step definitions and the plant's own station codes (js/seed.js).
- Over 2000 real defect descriptions and categories imported from the plant's Excel
  file.
- Real chassis numbers and sale codes from tractor labels.
- A photograph of a tractor label showing the barcodes and printed codes.
- There is no chassis-to-sale-code master list; the planner's MB52 stock list does not
  contain that mapping. Future work must not assume one exists.
- No user research, usability testing or field observation has been done. Nothing may
  claim otherwise.

## Product Principles

1. One screen per station. A station operator's whole job fits on İstasyonum; lists,
   queues and reports belong to the administrator and must not crowd the operator.
2. The work comes to the person. A tractor appears at a station when it is that
   station's turn; no one hunts through a list to find their work.
3. Record what happened, never guess. Skipped steps, unresolved defects and unread
   labels are recorded as such rather than filled in with a plausible value.
4. Wrong data is worse than no data. Chassis and sale code are error-intolerant: read
   them from the label where possible, and when read by OCR mark them for the person to
   confirm.
5. The floor sets the constraints. Gloves, glare, one hand and noise decide target
   sizes, contrast and feedback — not desktop convention.

## Accessibility & Inclusion

Touch targets must survive gloved use and one-handed reach; primary actions belong
within thumb reach rather than in the top corners. Text and status colours must stay
legible under glare, which means holding to WCAG AA contrast as a floor rather than a
goal. Status must never be carried by colour alone, since colour vision deficiency and
glare both defeat it. Confirmation must be visual and haptic, never audible.

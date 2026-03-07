# Facebook Launch Plan — Tenths Racing

## Status

- [x] Facebook Page created: Tenths Racing
- [x] Facebook App created: Tenths Social Manager
- [ ] **Step 3: Get Page Access Token** (Graph API Explorer — blocked by Meta maintenance, retry)
- [ ] Step 4: Exchange for long-lived token
- [ ] Step 5: Get Page ID
- [ ] Step 6: Set env vars (FB_PAGE_ID, FB_PAGE_ACCESS_TOKEN, FB_APP_ID, FB_APP_SECRET)
- [ ] Install deps: `npm install playwright formdata-node && npx playwright install chromium`
- [ ] Post to Tenths Racing page
- [ ] Share to groups (one per day, don't spam)

## Graph API Explorer Steps (when it unblocks)

1. Go to developers.facebook.com/tools/explorer
2. Select "Tenths Social Manager" app from dropdown
3. Click "Get Token" > "Get Page Access Token"
4. Select the "Tenths Racing" page
5. Add permissions: `pages_manage_posts`, `pages_read_engagement`
6. Click "Generate Access Token" — copy it
7. Exchange for long-lived token:
   ```
   GET /oauth/access_token?grant_type=fb_exchange_token&client_id={APP_ID}&client_secret={APP_SECRET}&fb_exchange_token={SHORT_LIVED_TOKEN}
   ```
8. Get Page ID:
   ```
   GET /me/accounts
   ```
   Find "Tenths Racing" — the `id` field is your FB_PAGE_ID.

## Promo

- Code: `TENTHS-FB01`
- 30 days free, 10 uses, expires June 5 2026
- Link: tenths.racing/promo/TENTHS-FB01

## Screenshots

Located at: `tenths-social-manager/landing-screenshots/`

| File | Content |
|------|---------|
| `01-hero.png` | Brand shot — "Every Tenth Matters" with tachometer |
| `02-setup-demo.png` | Setup Calculator with track condition picker |
| `03-gear-ratio-demo.png` | Gear Ratio Calculator with RPM analysis |
| `04-corner-weight-demo.png` | Corner Weight Calculator with results |
| `05-troubleshooter-demo.png` | Diagnostic Troubleshooter flow |
| `06-tool-showcase.png` | Engine Simulator + Session Logger |
| `07-pricing.png` | Free & Pro pricing plans |
| `08-built-for-garage.png` | "Built for the Garage" CTA |

---

## Post Schedule

### Day 1: Tenths Racing Page (main post)

**Screenshot:** `01-hero.png`

> We just launched on Facebook. If you're here, you probably already know — the difference between winning and second place is measured in tenths.
>
> Tenths is a setup toolkit built for short-track racers who wrench their own cars. Corner weight calculator, gear ratio tools, engine simulator, tech inspection checklists — all the stuff you'd normally figure out with a notebook and a calculator, except it actually works at 11pm in the shop.
>
> We're giving our first 10 Facebook followers a free 30-day trial of Tenths Pro. No gimmicks, just try it before race season hits.
>
> Grab yours here: tenths.racing/promo/TENTHS-FB01
>
> Every tenth matters.

- [ ] Posted

---

### Day 1-2: Setup & Tech Groups (highest value)

#### Hobby & Stock Car Set Up & Tech
https://www.facebook.com/groups/365554110692217/

**Screenshot:** `04-corner-weight-demo.png`

> Free corner weight calculator if anybody wants to try it — enter your scale readings and it gives you cross-weight %, left %, rear %, diagonal bias, and tells you how many turns on the jack bolts to hit your target. Also has a gear ratio calculator that shows where peak torque and peak HP land at every speed for your rear gear and tire combo.
>
> Built it because I got tired of doing the math on paper at 11pm in the shop.
>
> tenths.racing — free to use, no account needed for the calculators.
>
> First 10 people from this group get 30 days of Pro free (engine simulator, session logging): tenths.racing/promo/TENTHS-FB01

- [ ] Shared

#### Dirt Track Race Car Setup
https://www.facebook.com/groups/390013295930025/

**Screenshot:** `03-gear-ratio-demo.png`

> Sharing a gear ratio tool I built for short track guys. Pick your transmission (TH350, TH400, Powerglide, Muncie, Saginaw), enter your rear gear and tire diameter, and it shows exactly where peak torque and peak HP land at every speed. Color-coded so you can see if you're leaving power on the table.
>
> Also has a setup calculator that adjusts spring rates, alignment, and tire pressures based on track conditions (heavy through slick).
>
> Free at tenths.racing. Pro trial for the first 10 people: tenths.racing/promo/TENTHS-FB01

- [ ] Shared

---

### Day 3-4: Division Groups

#### Factory Stock Racing
https://www.facebook.com/groups/222986813288506/

**Screenshot:** `05-troubleshooter-demo.png`

> If your car's pushing, loose, or doing something weird and you're not sure where to start — I built a diagnostic troubleshooter for short track cars. Answer 3 questions about what the car's doing and it gives you prioritized adjustments ranked from easiest to most involved.
>
> Also has free corner weight and gear ratio calculators. No account needed.
>
> tenths.racing — 30 days of Pro free for the first 10: tenths.racing/promo/TENTHS-FB01

- [ ] Shared

#### Street Stock Racing Then and Now
https://www.facebook.com/groups/1860421954203290/

**Screenshot:** `06-tool-showcase.png`

> Built some tools for street stock guys who do their own wrenching. Free setup calculator, gear ratio calc, corner weight calc, and a diagnostic troubleshooter. Pro gets you an engine simulator (build a 355 SBC and see the power curve before you spend money) and a session logger to track what you changed and how the car felt.
>
> Not trying to replace experience — just trying to make the math faster so you can spend more time turning wrenches.
>
> tenths.racing — first 10 get 30 days Pro free: tenths.racing/promo/TENTHS-FB01

- [ ] Shared

#### IMCA Racing Parts, Cars & Trade
https://www.facebook.com/groups/519302958081961/

**Screenshot:** `02-setup-demo.png`

> Not selling parts but figured this group might find it useful — free setup calculator for dirt track cars. Pick your track conditions (heavy, tacky, moderate, dry, slick) and it recommends spring rates, alignment specs, and tire pressures. Also has gear ratio and corner weight calculators.
>
> Built for guys running IMCA classes who set up their own stuff.
>
> tenths.racing — no account needed for the free tools. 30 days Pro free for the first 10: tenths.racing/promo/TENTHS-FB01

- [ ] Shared

---

### Day 5-6: Figure 8 Groups

#### Race8 Figure 8 Racing Page
https://www.facebook.com/groups/388213654873793/

**Screenshot:** `04-corner-weight-demo.png`

> Any figure 8 guys scaling their cars? Built a free corner weight calculator — enter your four corner weights and it gives you cross-weight %, left/rear distribution, and jack bolt adjustment recommendations. Sounds overkill for figure 8 but getting the cross-weight right makes a huge difference in the intersection.
>
> tenths.racing — free, works on your phone at the track.
>
> 30 days Pro free for the first 10: tenths.racing/promo/TENTHS-FB01

- [ ] Shared

#### Carroll County Figure 8 Racing
https://www.facebook.com/groups/1592409947690801/

**Screenshot:** `03-gear-ratio-demo.png`

> Free gear ratio calculator if anyone's trying to figure out their final drive setup. Pick your transmission, rear gear, and tire size — it tells you where peak torque and HP land at every speed. Helps figure out if you're geared too tall or too short for your track.
>
> Also has a corner weight calc and diagnostic troubleshooter.
>
> tenths.racing/promo/TENTHS-FB01 — 30 days Pro free, 10 spots.

- [ ] Shared

#### United Iowa Figure 8 Racing
https://www.facebook.com/groups/523455184887318/

**Screenshot:** `03-gear-ratio-demo.png`

> Free gear ratio calculator if anyone's trying to figure out their final drive setup. Pick your transmission, rear gear, and tire size — it tells you where peak torque and HP land at every speed. Helps figure out if you're geared too tall or too short for your track.
>
> Also has a corner weight calc and diagnostic troubleshooter.
>
> tenths.racing/promo/TENTHS-FB01 — 30 days Pro free, 10 spots.

- [ ] Shared

---

## Pages to Tag (in the main Tenths Racing page post)

- IMCA Racing: https://www.facebook.com/RaceIMCA/ (132K followers)

## Quick Reference

| Group | Screenshot | Hook |
|-------|-----------|------|
| Tenths Racing Page | `01-hero` | Brand launch |
| Hobby & Stock Car Setup & Tech | `04-corner-weight-demo` | Corner weight calculator |
| Dirt Track Race Car Setup | `03-gear-ratio-demo` | Gear ratio tool |
| Factory Stock Racing | `05-troubleshooter-demo` | Diagnostic troubleshooter |
| Street Stock Then and Now | `06-tool-showcase` | Engine sim + session logger |
| IMCA Parts & Trade | `02-setup-demo` | Track condition setup calc |
| Race8 Figure 8 | `04-corner-weight-demo` | Cross-weight for intersection |
| Carroll County Figure 8 | `03-gear-ratio-demo` | Final drive gearing |
| United Iowa Figure 8 | `03-gear-ratio-demo` | Final drive gearing |

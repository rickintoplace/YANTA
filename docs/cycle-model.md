# How the cycle calendar calculates

Code: `src/cycle/cycle-model.js` (pure arithmetic, tested in
`test/calendar/cycle-model.test.js` and `cycle-days.test.js`). This page is
for anyone changing that file: the numbers in it come from the studies below.
It is not medical advice. A calendar estimate is not contraception, and the app
says so.

## What the data says

| Question | Finding | Source |
|---|---|---|
| Cycle length | Mean 29.3 days (612,613 cycles); 28.9 ± 3.4 (95 % within 22–36); 87 % between 23 and 35 days. | Bull 2019; Fehring 2006; Soumpasis 2020 |
| Variation within one person | 52 % of women vary by 5 or more days over four cycles; 42.5 % by more than 7 days. Variation is higher under 20 and from 45. | Soumpasis 2020; Fehring 2006; Li 2023 |
| Which phase varies | Mostly the follicular phase (before ovulation): r = 0.77 with cycle length. The luteal phase changes little: r = 0.37. | Soumpasis 2020; Fehring 2006; Sohda 2017 |
| Luteal phase (days *after* ovulation) | 12.4 days (95 % 7–17); 12.77 ± 1.86; 12.9 ± 1.7. | Bull 2019; Soumpasis 2020; Waller 1998 |
| Ovulation day in a 28-day cycle | Day 15 most often (27 %), then day 16 (21 %) and day 14 (20 %), spread over 10 days. In another study day 16 was most often (21 %). Not "day 14". | Soumpasis 2020; Johnson 2018 |
| Fertile window | Six days ending on the day of ovulation. Day-specific conception probability is about 0.10 five days before and about 0.33 on the day of ovulation (Wilcox 1995). After correcting for errors in dating ovulation, the highest probability is on the day before (Dunson 1999). It is close to zero after ovulation. | Wilcox 1995; Dunson 1999 |
| How unpredictable | Every day from 6 to 21 carries at least a 10 % chance of being fertile. Only about 30 % of women have the whole window within days 10–17. 95 % of cycles have it within days 4–23. | Wilcox 2000; Fehring 2006 |
| How good calendar apps are | They name the right ovulation day in at most 21 % of cycles. Cycle length alone cannot pin it down. | Johnson 2018; Soumpasis 2020 |
| A conservative rule that was tested | Standard Days Method: days 8–19 for cycles of 26–32 days; 4.75 % pregnancies per year with correct use. | Arévalo 2002 |

## What the model does with it

1. **Cycle length.** It takes a recency-weighted median of the logged cycles
   (half-life 6 cycles). This is shrunk towards 29 ± 4 days, so a single cycle
   does not decide everything. Gaps that look like a missed entry (k = 2 or 3
   cycles more likely than one) do not count (Li et al. 2022). A late period
   moves the forecast, because the next-start distribution is conditioned on
   every day that passed without one.
2. **Ovulation** is counted back from the next start: next first day minus
   13.7 ± 1.9 days. That is the luteal phase plus the day of ovulation itself,
   averaged over the three studies above. It puts ovulation in a 28-day
   cycle on day 15, as measured.
   - A logged, confirmed ovulation (LH test, temperature rise) replaces the
     estimate for that cycle and personalises the 13.7 over time.
   - The day shown is the single most probable day.
3. **Fertile window, graded:**
   - **Fruchtbar** (strong): the six days ending on the most likely ovulation.
   - **Möglicherweise fruchtbar** (faint): every further day with at least a
     10 % chance of lying in the six-day window, given how uncertain this
     person's ovulation day is. It is wide with little data: days 6–22 after
     one logged period, which reproduces Wilcox 2000. It narrows as cycles are
     logged: days 7–19 for regular 28-day cycles, close to the Standard Days
     Method.
4. **Periods ahead** are drawn as one usual period from the most likely first
   day. Uncertainty shows in how faint they are and in the stated range
   ("70 % between …"), not in their width.

## Sources (PubMed)

- Bull JR et al. Real-world menstrual cycle characteristics of more than
  600,000 menstrual cycles. *NPJ Digit Med* 2019. doi:10.1038/s41746-019-0152-7
- Soumpasis I, Grace B, Johnson S. Real-life insights on menstrual cycles and
  ovulation using big data. *Hum Reprod Open* 2020. doi:10.1093/hropen/hoaa011
- Waller K et al. Use of urine biomarkers to evaluate menstrual function in
  healthy premenopausal women. *Am J Epidemiol* 1998.
  doi:10.1093/oxfordjournals.aje.a009401
- Fehring RJ, Schneider M, Raviele K. Variability in the phases of the
  menstrual cycle. *JOGNN* 2006. doi:10.1111/j.1552-6909.2006.00051.x
- Wilcox AJ, Weinberg CR, Baird DD. Timing of sexual intercourse in relation
  to ovulation. *N Engl J Med* 1995. doi:10.1056/NEJM199512073332301
- Dunson DB et al. Day-specific probabilities of clinical pregnancy based on
  two studies with imperfect measures of ovulation. *Hum Reprod* 1999.
  doi:10.1093/humrep/14.7.1835
- Wilcox AJ, Dunson D, Baird DD. The timing of the "fertile window" in the
  menstrual cycle. *BMJ* 2000. doi:10.1136/bmj.321.7271.1259
- Johnson S, Marriott L, Zinaman M. Can apps and calendar methods predict
  ovulation with accuracy? *Curr Med Res Opin* 2018.
  doi:10.1080/03007995.2018.1475348
- Sohda S, Suzuki K, Igari I. Relationship between the menstrual cycle and
  timing of ovulation revealed by new protocols. *J Med Internet Res* 2017.
  doi:10.2196/jmir.7468
- Li H et al. Menstrual cycle length variation by demographic characteristics
  from the Apple Women's Health Study. *NPJ Digit Med* 2023.
  doi:10.1038/s41746-023-00848-1
- Arévalo M, Jennings V, Sinai I. Efficacy of a new method of family planning:
  the Standard Days Method. *Contraception* 2002.
  doi:10.1016/s0010-7824(02)00288-3
- Najmabadi S et al. Characteristics of menstrual cycles with or without
  intercourse in women with no known subfertility. *Hum Reprod Open* 2022.
  doi:10.1093/hropen/hoac039

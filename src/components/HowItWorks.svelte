<script lang="ts">
  import { tick } from 'svelte';
  import V from '../generated/validation.json';
  import { formatInt } from '../lib/format';
  import { app } from '../state/app.svelte';
  import { tex } from './tex';

  let dlg = $state<HTMLDialogElement>();
  let body = $state<HTMLDivElement>();

  $effect(() => {
    const open = app.howOpen;
    const d = dlg;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      void tick().then(() => {
        const target = app.howSection ? document.getElementById(`how-${app.howSection}`) : null;
        if (target) target.scrollIntoView({ block: 'start' });
        else if (body) body.scrollTop = 0;
        app.howSection = null;
      });
    } else if (!open && d.open) {
      d.close();
    }
  });

  function onBackdrop(e: MouseEvent) {
    if (e.target === dlg) app.howOpen = false;
  }

  const c = V.catalogue;
  const pct = (n: number) => ((100 * n) / c.total).toFixed(1);
  const b1 = V.bValue.find((v) => v.bTrue === 1)!;
  const toc = [
    ['depth', 'What depth tells us'],
    ['slabs', 'Subduction and Wadati–Benioff zones'],
    ['deep', 'Deep-focus earthquakes'],
    ['completeness', 'Catalogue completeness'],
    ['bvalue', 'The b-value'],
    ['sections', 'Great circles and sections'],
    ['validation', 'Validation'],
    ['limits', 'Limitations'],
    ['credits', 'Data, credits and prior art'],
  ];
</script>

<dialog
  bind:this={dlg}
  class="how"
  aria-labelledby="how-title"
  onclose={() => (app.howOpen = false)}
  onclick={onBackdrop}
>
  <div class="sheet">
    <header>
      <p class="eyebrow">Appendix · Method</p>
      <h2 id="how-title">How it works</h2>
      <button
        class="btn quiet close"
        type="button"
        onclick={() => (app.howOpen = false)}
        aria-label="Close"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"
          ><path
            d="M3.5 3.5l9 9M12.5 3.5l-9 9"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linecap="round"
          /></svg
        >
      </button>
    </header>
    <div class="body" bind:this={body}>
      <p class="lede">
        Deep Focus is an exploratory data tool built on the authoritative USGS earthquake catalogue.
        It plots all {formatInt(c.total)} earthquakes of magnitude 5 and above recorded from 1973 to 2025,
        and applies standard, published methods to whatever you select. The methods are validated against
        synthetic data with known answers (below); results for real selections are descriptive statistics,
        not a research-grade analysis.
      </p>
      <nav aria-label="Contents">
        <ol class="toc">
          {#each toc as [id, label] (id)}
            <li><a href={`#how-${id}`}>{label}</a></li>
          {/each}
        </ol>
      </nav>

      <section id="how-depth">
        <h3>What depth tells us</h3>
        <p>
          An earthquake's <em>hypocentre</em> is the point where rupture starts; its depth is
          measured below sea level. Seismologists group earthquakes as <strong>shallow</strong>
          (above 70 km),
          <strong>intermediate</strong> (70–300 km) and <strong>deep</strong> (300–700 km). In this
          catalogue
          {pct(c.classes.shallow)}% are shallow, {pct(c.classes.intermediate)}% intermediate and
          {pct(c.classes.deep)}% deep.
        </p>
        <p>
          Shallow earthquakes happen almost everywhere plates meet. Earthquakes far below the crust
          are different: rock that deep is normally too hot to break, so they only occur where cold
          lithosphere has been carried down into the mantle. Their depth maps the plates we cannot
          see.
        </p>
      </section>

      <section id="how-slabs">
        <h3>Subduction and Wadati–Benioff zones</h3>
        <p>
          Where an oceanic plate sinks beneath another, it slides into the mantle as a cold <em
            >slab</em
          >
          and keeps breaking as it descends. Its earthquakes trace an inclined sheet below the trench
          — described by Kiyoo Wadati in Japan in the 1920s and by Hugo Benioff around 1950, and now called
          a Wadati–Benioff zone. Turn on <em>True depth</em> and the slabs appear as glowing sheets under
          Tonga, Japan and the Andes; a cross-section shows one edge-on.
        </p>
        <p>
          The tool fits a straight line to the earthquakes in a section that lie below a chosen
          depth (70 km by default, which drops most crustal and plate-interface events) and reports
          its dip. Real slabs bend — Tonga steepens with depth, central Chile flattens — so the
          number is a mean dip over the fitted depth range.
        </p>
      </section>

      <section id="how-deep">
        <h3>Deep-focus earthquakes</h3>
        <p>
          Below about 300 km pressures exceed 10 GPa, where ordinary frictional sliding should be
          impossible, yet earthquakes continue to about 700 km. The leading explanations involve the
          slab's cold core: minerals (olivine) that stay in their low-pressure form far deeper than
          they should, and then transform suddenly under stress (<em>transformational faulting</em
          >), along with dehydration and thermal runaway. Seismicity stops near the 660 km
          discontinuity, where mantle minerals change phase again — the dashed lines in the section
          chart. The largest deep earthquakes on record are here too: Bolivia 1994 (M 8.2, 631 km)
          and the Sea of Okhotsk 2013 (M 8.3, 598 km).
        </p>
      </section>

      <section id="how-completeness">
        <h3>Catalogue completeness</h3>
        <p>
          A catalogue is <em>complete</em> above the magnitude M<sub>c</sub> at which (almost) every
          earthquake is detected. Networks were sparser in the 1970s, so M 5 is close to the
          completeness limit in early years. The statistics therefore estimate M<sub>c</sub> for
          each selection by
          <strong>maximum curvature</strong> (Wiemer &amp; Wyss 2000): the most populated
          0.1-magnitude bin. It is a fast, robust estimator, known to underestimate M<sub>c</sub> when
          detection fades gradually (Woessner &amp; Wiemer 2005). When the most populated bin is the catalogue's
          own floor (5.0), completeness below it cannot be checked.
        </p>
        <p>
          Two other catalogue habits show in the charts. Depths that could not be measured are often
          fixed at a default (10 km, or 33 and 35 km in older solutions), producing the tall spikes
          in the depth histogram. And magnitudes come in several types — body-wave <em>m</em><sub
            >b</sub
          >
          ({c.magTypeShares.mb}%), moment magnitudes M<sub>w</sub> (about {(
            c.magTypeShares.mwc +
            c.magTypeShares.mww +
            c.magTypeShares.mw +
            c.magTypeShares.mwb
          ).toFixed(0)}%), surface-wave M<sub>s</sub> ({c.magTypeShares.ms}%) — which are not
          perfectly interchangeable.
        </p>
      </section>

      <section id="how-bvalue">
        <h3>The b-value</h3>
        <p>
          Above M<sub>c</sub>, earthquake numbers fall off exponentially with magnitude
          (Gutenberg–Richter law):
        </p>
        <p class="eq" use:tex={{ src: '\\log_{10} N(\\ge M) = a - bM', display: true }}></p>
        <p>
          b ≈ 1 means ten times fewer earthquakes per unit of magnitude. The maximum-likelihood
          estimate (Aki 1965), with Utsu's (1965) correction for magnitudes rounded to bins of width
          ΔM = 0.1, is
        </p>
        <p
          class="eq"
          use:tex={{
            src: '\\hat b = \\frac{\\log_{10} e}{\\bar M - \\left(M_c - \\Delta M/2\\right)}',
            display: true,
          }}
        ></p>
        <p>
          where M̄ is the mean magnitude of the n events at or above M<sub>c</sub>. Its standard
          error (Shi &amp; Bolt 1982) is
        </p>
        <p
          class="eq"
          use:tex={{
            src: '\\sigma_b = 2.30\\, \\hat b^{\\,2} \\sqrt{\\frac{\\sum_{i=1}^{n} (M_i - \\bar M)^2}{n(n-1)}}',
            display: true,
          }}
        ></p>
        <p>
          (computed with ln 10 = 2.3026 for their rounded 2.30). For the whole catalogue b = {c.bAll?.b.toFixed(
            2,
          )} ± {c.bAll?.sigma.toFixed(3)}; for deep earthquakes alone it is lower, {c.bDeep?.b.toFixed(
            2,
          )} ± {c.bDeep?.sigma.toFixed(3)}. The ± is the statistical error only — mixed magnitude
          types and completeness change b by more than that.
        </p>
      </section>

      <section id="how-sections">
        <h3>Great circles and sections</h3>
        <p>
          The Earth is treated as a sphere of radius R = 6371.0088 km. Distances use the haversine
          formula,
        </p>
        <p
          class="eq"
          use:tex={{
            src: 'd = 2R\\,\\operatorname{atan2}\\!\\left(\\sqrt{h},\\sqrt{1-h}\\right)',
            display: true,
          }}
        ></p>
        <p
          class="eq"
          use:tex={{
            src: 'h = \\sin^2\\tfrac{\\Delta\\varphi}{2} + \\cos\\varphi_1 \\cos\\varphi_2 \\sin^2\\tfrac{\\Delta\\lambda}{2}',
            display: true,
          }}
        ></p>
        <p>
          A section runs along the great circle from A to A′. With unit vectors <strong>a</strong>,
          <strong>b</strong> to its ends and <strong>p</strong> to an epicentre, let
          <span
            use:tex={{
              src: '\\mathbf{n} = \\mathbf{a}\\times\\mathbf{b} / \\lVert\\mathbf{a}\\times\\mathbf{b}\\rVert',
            }}
          ></span>
          and
          <span use:tex={{ src: '\\mathbf{t} = \\mathbf{n}\\times\\mathbf{a}' }}></span>. Then
        </p>
        <p
          class="eq"
          use:tex={{
            src: '\\delta = \\arcsin(\\mathbf{p}\\cdot\\mathbf{n})',
            display: true,
          }}
        ></p>
        <p
          class="eq"
          use:tex={{
            src: '\\theta = \\operatorname{atan2}(\\mathbf{p}\\cdot\\mathbf{t},\\ \\mathbf{p}\\cdot\\mathbf{a})',
            display: true,
          }}
        ></p>
        <p>
          give the cross-track distance Rδ and the along-track distance Rθ. An earthquake belongs to
          the section when 0 ≤ θ ≤ θ<sub>AA′</sub> and |Rδ| is within the half-width, and is plotted at
          (Rθ, depth). Unrolling the curved slice this way keeps surface distances true; at 600 km depth
          the true horizontal distance is about 9% shorter.
        </p>
        <p>
          The slab dip is the angle of the principal axis of the deeper events in that plane — a
          total-least-squares line, which treats distance and depth alike and stays stable for
          near-vertical slabs:
        </p>
        <p
          class="eq"
          use:tex={{
            src: '\\phi = \\tfrac12 \\operatorname{atan2}\\!\\left(2C_{xz},\\ C_{xx} - C_{zz}\\right), \\quad \\text{dip} = \\lvert\\phi\\rvert',
            display: true,
          }}
        ></p>
        <p>
          where C is the covariance matrix of (distance, depth) in km. Events more than three robust
          standard deviations (1.4826 × the median absolute residual, at least 10 km) from a first
          fit are set aside and the line refitted; the ± is the standard deviation over 300
          bootstrap resamples with a fixed seed. On the globe, true-depth mode places an earthquake
          at radius R − kz, where z is its depth and k the vertical exaggeration you choose (×1, ×2,
          ×4).
        </p>
      </section>

      <section id="how-validation">
        <h3>Validation</h3>
        <ul>
          <li>
            <strong>b-value.</strong> 200 synthetic Gutenberg–Richter catalogues of 5,000 events
            each for b = 0.8, 1.0 and 1.2: mean estimates {V.bValue
              .map((v) => v.meanB.toFixed(3))
              .join(', ')}; worst error
            {Math.max(...V.bValue.map((v) => v.maxAbsError)).toFixed(3)}; {V.bValue.reduce(
              (s, v) => s + v.withinTolerance,
              0,
            )} of 600 within ±0.05. Without Utsu's correction the mean for b = 1 would be {b1.meanWithoutUtsuCorrection.toFixed(
              3,
            )}.
          </li>
          <li>
            <strong>Uncertainty.</strong> The Shi &amp; Bolt error predicts the actual scatter of b
            over repeated catalogues to within {Math.round(
              Math.max(...V.bValue.map((v) => Math.abs(v.shiBoltOverEmpirical - 1))) * 100,
            )}%.
          </li>
          <li>
            <strong>M<sub>c</sub>.</strong> Maximum curvature recovers the true M<sub>c</sub> = 5.0
            in
            {V.mc.exact} of {V.mc.catalogues} catalogues with a steep detection roll-off.
          </li>
          <li>
            <strong>Slab dip.</strong> Synthetic slabs of 400 events with 15 km scatter, dipping
            20–85°: mean errors below {Math.max(
              ...V.dip.map((d) => Math.abs(d.meanDip - d.trueDip)),
            ).toFixed(1)}° and every fit within
            {Math.max(...V.dip.map((d) => d.maxAbsError)).toFixed(1)}° (the depth cut-off biases
            shallow dips slightly low). The bootstrap σ matches the true scatter of fits (e.g. {V.dip[2].meanBootstrapSigma.toFixed(
              2,
            )}° vs {V.dip[2].sdDip.toFixed(2)}° at 45°).
          </li>
          <li>
            <strong>Geodesy.</strong> Haversine reproduces the Rosetta Code reference (2886.444 km)
            to 10⁻⁹ km; along- and cross-track distances of {formatInt(V.geodesy.constructedCases)} constructed
            points agree to better than a micrometre.
          </li>
          <li>
            <strong>Data.</strong> All {c.years} yearly counts match the USGS <code>/count</code>
            endpoint ({formatInt(c.total)} events, all ids unique); the 2011 Tōhoku M 9.1, 1994 Bolivia
            M 8.2 (631 km) and 2013 Sea of Okhotsk M 8.3 (598 km) earthquakes are present with USGS values.
          </li>
        </ul>
      </section>

      <section id="how-limits">
        <h3>Limitations</h3>
        <ul>
          <li>
            Locations and depths are the catalogue's, not relocated; global M 5 epicentres are
            uncertain by roughly 5–15 km and many depths are fixed defaults.
          </li>
          <li>
            The dip is a single straight line through a slab that may bend, tear or flatten; a
            corridor that runs obliquely to the trench shows an apparent dip shallower than the true
            one.
          </li>
          <li>
            b-values mix magnitude types and decades of changing networks; they compare selections,
            they do not measure stress.
          </li>
          <li>The Earth is a sphere here (≈0.5% error in distance against the WGS84 ellipsoid).</li>
          <li>
            The live layer shows the USGS feed as published; its locations and magnitudes are often
            preliminary.
          </li>
        </ul>
      </section>

      <section id="how-credits">
        <h3>Data, credits and prior art</h3>
        <ul>
          <li>
            Earthquakes: <a href="https://earthquake.usgs.gov/fdsnws/event/1/"
              >USGS ANSS Comprehensive Earthquake Catalog (ComCat)</a
            >, FDSN event service, M 5.0+, 1973–2025, fetched
            {c.fetchedAt.slice(0, 10)}. USGS-authored data are in the U.S. public domain. Live
            layer: the USGS real-time feed of M 2.5+ earthquakes in the past 30 days.
          </li>
          <li>
            Coastlines: <a href="https://www.naturalearthdata.com/">Natural Earth</a> 1:50m (public domain).
          </li>
          <li>
            Plate boundaries: P. Bird (2003), <em>An updated digital model of plate boundaries</em>,
            G³ 4(3), 1027; GeoJSON by Hugo Ahlenius, Nordpil —
            <a href="https://github.com/fraxen/tectonicplates">fraxen/tectonicplates</a>, Open Data
            Commons Attribution License 1.0.
          </li>
          <li>
            Methods: Aki (1965); Utsu (1965); Shi &amp; Bolt (1982), BSSA 72(5); Wiemer &amp; Wyss
            (2000), BSSA 90(4); Woessner &amp; Wiemer (2005), BSSA 95(2); Ottosson (2020), OKLab
            colour space.
          </li>
          <li>
            Software: Svelte, three.js, D3 (scale, shape, axis, geo), KaTeX — all MIT/ISC licensed.
            Fonts: Source Serif 4 and Source Sans 3 (SIL Open Font License).
          </li>
          <li>
            Prior art: the <a href="https://seismic-explorer.concord.org/"
              >Concord Consortium Seismic Explorer</a
            >
            (cross-sections and a 3D view for classrooms), the
            <a href="https://ds.iris.edu/ieb/">EarthScope/IRIS Earthquake Browser</a> (3D viewer,
            exports) and the
            <a href="https://earthquake.usgs.gov/earthquakes/map/">USGS Latest Earthquakes</a> map. Deep
            Focus adds a fitted slab dip with uncertainty on any section, b-value statistics for any selection
            and a guided depth narrative, as a static site that works offline once loaded.
          </li>
        </ul>
      </section>
    </div>
  </div>
</dialog>

<style>
  .how {
    width: min(760px, 100vw);
    max-width: 100vw;
    height: 100dvh;
    max-height: 100dvh;
    margin: 0 0 0 auto;
    padding: 0;
    border: 0;
    background: var(--paper);
    color: var(--ink);
    box-shadow: -20px 0 60px rgba(0, 0, 0, 0.35);
  }

  .how::backdrop {
    background: rgba(14, 17, 22, 0.55);
  }

  .sheet {
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  header {
    position: relative;
    padding: 20px 64px 14px 28px;
    border-bottom: 1px solid var(--rule);
  }

  h2 {
    margin: 2px 0 0;
    font-family: var(--serif);
    font-weight: 600;
    font-size: 1.8rem;
  }

  .close {
    position: absolute;
    top: 14px;
    right: 14px;
    width: 44px;
    padding: 0;
  }

  .body {
    flex: 1;
    overflow-y: auto;
    padding: 18px 28px 48px;
    font-family: var(--serif);
    font-size: 1.02rem;
    line-height: 1.6;
  }

  .lede {
    margin-top: 0;
    font-size: 1.1rem;
  }

  .toc {
    columns: 2;
    column-gap: 24px;
    margin: 0 0 8px;
    padding: 12px 16px 12px 36px;
    border: 1px solid var(--rule);
    border-radius: var(--radius);
    background: var(--paper-raised);
    font-family: var(--sans);
    font-size: 0.9rem;
  }

  .toc li {
    break-inside: avoid;
    padding: 2px 0;
  }

  .toc a {
    color: var(--ink);
    text-underline-offset: 2px;
  }

  section {
    padding-top: 10px;
    scroll-margin-top: 12px;
  }

  h3 {
    margin: 16px 0 6px;
    font-family: var(--serif);
    font-size: 1.3rem;
    font-weight: 650;
  }

  .eq {
    margin: 10px 0;
    overflow-x: auto;
    overflow-y: hidden;
    padding: 2px 0;
  }

  ul {
    padding-left: 1.2em;
  }

  li {
    margin: 4px 0;
  }

  a {
    color: var(--accent);
    text-underline-offset: 2px;
  }

  code {
    font-size: 0.9em;
  }

  @media (max-width: 600px) {
    header {
      padding: 16px 60px 12px 18px;
    }

    .body {
      padding: 14px 18px 40px;
      font-size: 1rem;
    }

    .toc {
      columns: 1;
    }

    .eq {
      font-size: 0.9rem;
    }
  }
</style>

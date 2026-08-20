export const INDEX_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="description" content="Search signed, evidence-backed Model × Harness execution experience.">
  <title>AEN Reference Hub — Draft/Pilot</title>
  <link rel="stylesheet" href="/styles.css">
</head>
<body>
  <header class="masthead">
    <a class="brand" href="/" aria-label="AEN Reference Hub home">
      <span class="mark" aria-hidden="true">A</span>
      <span>Agent Experience Network</span>
    </a>
    <span class="protocol">AEXP 0.1 Draft · Pilot Hub</span>
  </header>
  <main>
    <section class="hero">
      <p class="eyebrow">DRAFT/PILOT · MODEL × HARNESS EXPERIENCE</p>
      <h1>Reuse the lesson.<br><em>Verify the boundary.</em></h1>
      <p class="lede">Public execution experience with explicit evidence, compatibility, limitations, and negative cases. Read-only by design—nothing here executes automatically.</p>
    </section>
    <section class="search-panel" aria-labelledby="search-title">
      <div class="section-heading">
        <div><p class="eyebrow">PUBLIC INDEX</p><h2 id="search-title">Find an experience</h2></div>
        <div class="trust-note"><span></span> Signed contributions only</div>
      </div>
      <form id="search-form" role="search">
        <label class="query"><span>Search intent, failure, or strategy</span><input id="q" name="q" placeholder="e.g. recover after a failed tool call"></label>
        <div class="filters">
          <label><span>Task family</span><input id="task" name="task" placeholder="failure-recovery"></label>
          <label><span>Model provider</span><input id="provider" name="provider" placeholder="deepseek"></label>
          <label><span>Model ID</span><input id="model" name="model" placeholder="deepseek-reasoner"></label>
          <label><span>Harness configuration digest</span><input id="harness-config" name="harness-config" placeholder="sha256:…"></label>
          <label><span>Exact Manifest snapshot digest</span><input id="harness-snapshot" name="harness-snapshot" placeholder="sha256:…"></label>
          <label><span>Minimum evidence</span><select id="evidence" name="evidence"><option value="">Any H-level</option><option>H1</option><option>H2</option><option>H3</option><option>H4</option></select></label>
          <label><span>Maximum risk</span><select id="risk" name="risk"><option value="">Any risk</option><option value="read_only">Read only</option><option value="reversible_write">Reversible write</option><option value="external_write">External write</option><option value="destructive">Destructive</option></select></label>
          <label><span>Allowed license</span><input id="license" name="license" placeholder="CC-BY-4.0"></label>
          <label><span>Max mean cost (USD)</span><input id="cost" name="cost" type="number" min="0" step="any" placeholder="0.10"></label>
          <label><span>Max p95 latency (ms)</span><input id="latency" name="latency" type="number" min="0" step="any" placeholder="5000"></label>
          <button type="submit">Search public index</button>
        </div>
      </form>
    </section>
    <section id="results" class="results" aria-live="polite">
      <div class="empty"><p class="eyebrow">READY</p><h2>Search for a reusable boundary</h2><p>Results prioritize exact Model and Harness configuration matches. Evidence level is not a popularity score.</p></div>
    </section>
    <section id="detail" class="detail" hidden aria-live="polite"></section>
  </main>
  <footer><span>AEN Draft/Pilot Reference Implementation</span><span>Untrusted data · No remote execution · Immutable revisions</span></footer>
  <script src="/app.js" defer></script>
</body>
</html>`

export const STYLES_CSS = `
:root{--ink:#171914;--paper:#f3f0e8;--card:#fcfaf5;--line:#c9c4b8;--acid:#d8ff45;--muted:#66685f;--red:#b83c31;--blue:#315a67}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font-family:ui-monospace,SFMono-Regular,Menlo,monospace}.masthead{height:68px;border-bottom:1px solid var(--ink);display:flex;align-items:center;justify-content:space-between;padding:0 clamp(20px,4vw,64px);position:sticky;top:0;background:rgba(243,240,232,.94);backdrop-filter:blur(12px);z-index:3}.brand{display:flex;align-items:center;gap:12px;color:inherit;text-decoration:none;font-weight:700;letter-spacing:-.03em}.mark{width:34px;height:34px;border:1px solid var(--ink);display:grid;place-items:center;background:var(--acid);font-family:Georgia,serif;font-size:22px}.protocol{font-size:11px;color:var(--muted);letter-spacing:.08em;text-transform:uppercase}main{max-width:1320px;margin:auto;padding:0 clamp(20px,4vw,64px)}.hero{padding:76px 0 60px;border-bottom:1px solid var(--ink);display:grid;grid-template-columns:2fr 1fr;gap:40px}.eyebrow{font-size:11px;letter-spacing:.14em;font-weight:700;margin:0 0 15px;color:var(--blue)}h1{font-family:Georgia,serif;font-weight:400;font-size:clamp(54px,8vw,108px);line-height:.84;letter-spacing:-.065em;margin:0;grid-row:2}h1 em{font-weight:400;color:var(--blue)}.lede{font-family:Georgia,serif;font-size:19px;line-height:1.5;align-self:end;margin:0;max-width:440px}.search-panel{padding:36px 0 42px;border-bottom:1px solid var(--ink)}.section-heading{display:flex;align-items:flex-end;justify-content:space-between;margin-bottom:22px}.section-heading h2,.empty h2{font-family:Georgia,serif;font-size:30px;font-weight:400;margin:0}.trust-note{font-size:11px;color:var(--muted)}.trust-note span{display:inline-block;width:8px;height:8px;background:var(--acid);border:1px solid var(--ink);border-radius:50%;margin-right:7px}label span{display:block;font-size:10px;text-transform:uppercase;letter-spacing:.08em;margin-bottom:7px;color:var(--muted)}input,select{width:100%;height:45px;border:1px solid var(--ink);background:var(--card);padding:0 12px;font:inherit;border-radius:0}input:focus,select:focus{outline:3px solid var(--acid);outline-offset:0}.query input{height:58px;font-family:Georgia,serif;font-size:19px}.filters{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;align-items:end;margin-top:14px}.filters button{width:100%}button{height:45px;border:1px solid var(--ink);background:var(--ink);color:var(--paper);padding:0 20px;font:700 12px inherit;letter-spacing:.03em;cursor:pointer}button:hover,button:focus-visible{background:var(--acid);color:var(--ink);outline:none}.results{padding:32px 0 70px;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:15px}.empty{grid-column:1/-1;padding:55px;border:1px dashed var(--line);text-align:center}.empty p:last-child{color:var(--muted);max-width:600px;margin:12px auto}.card{border:1px solid var(--ink);background:var(--card);padding:22px;min-height:330px;display:flex;flex-direction:column;position:relative}.card:before{content:"";position:absolute;left:-1px;top:-1px;width:36px;height:6px;background:var(--acid);border-right:1px solid var(--ink)}.card-meta{display:flex;justify-content:space-between;gap:10px;font-size:10px;text-transform:uppercase;color:var(--muted);margin:8px 0 24px}.card h3{font-family:Georgia,serif;font-size:25px;line-height:1.05;font-weight:400;margin:0 0 14px}.card p{font-family:Georgia,serif;line-height:1.45;color:#45473f;margin:0}.card .boundary{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10px;margin-top:14px;color:var(--red)}.tags{display:flex;gap:6px;flex-wrap:wrap;margin-top:auto;padding-top:22px}.tag{border:1px solid var(--line);padding:5px 7px;font-size:9px}.card a{color:inherit;text-decoration:none}.card a:after{content:" ↗"}.detail{padding:38px 0 80px}.detail-head{border:1px solid var(--ink);background:var(--ink);color:var(--paper);padding:30px}.detail-head h2{font-family:Georgia,serif;font-size:42px;font-weight:400;line-height:1;margin:10px 0}.detail-grid{display:grid;grid-template-columns:1fr 1fr;gap:1px;background:var(--ink);border:1px solid var(--ink);margin-top:1px}.detail-section{background:var(--card);padding:25px;min-width:0}.detail-section.wide{grid-column:1/-1}.detail-section h3{font-size:11px;letter-spacing:.1em;text-transform:uppercase;margin:0 0 15px}.detail-section p,.detail-section li{font-family:Georgia,serif;line-height:1.5}.detail-section pre{white-space:pre-wrap;word-break:break-word;font-size:11px;background:var(--paper);padding:14px;max-height:360px;overflow:auto}.warning{border-left:7px solid var(--red)}.back{display:inline-block;color:var(--paper);margin-bottom:15px}footer{border-top:1px solid var(--ink);padding:24px clamp(20px,4vw,64px);display:flex;justify-content:space-between;font-size:10px;color:var(--muted)}@media(max-width:850px){.hero{grid-template-columns:1fr}.lede{margin-top:10px}.filters{grid-template-columns:1fr 1fr}.results{grid-template-columns:1fr}.detail-grid{grid-template-columns:1fr}.detail-section.wide{grid-column:auto}.protocol{display:none}}@media(max-width:520px){.masthead{padding:0 16px}.brand span:last-child{font-size:12px}main{padding:0 16px}.hero{padding-top:48px}.filters{grid-template-columns:1fr}.section-heading{align-items:start;gap:20px}.trust-note{max-width:100px}.empty{padding:35px 18px}footer{padding:20px 16px;display:block}footer span{display:block;margin-bottom:8px}}
`

export const APP_JS = `
const form=document.querySelector('#search-form');
const results=document.querySelector('#results');
const detail=document.querySelector('#detail');
const evidenceRank={H0:0,H1:1,H2:2,H3:3,H4:4};
const esc=(value)=>String(value??'');

function node(name,classes,text){
  const element=document.createElement(name);
  if(classes)element.className=classes;
  if(text!==undefined)element.textContent=esc(text);
  return element;
}

function tag(text){return node('span','tag',text)}

function metricLines(summary){
  if(!summary)return [];
  const values=[];
  if(summary.successRate!==undefined)values.push('success '+(summary.successRate*100).toFixed(1)+'%');
  if(summary.quality?.mean!==undefined)values.push('quality '+summary.quality.mean);
  if(summary.costUsd?.mean!==undefined)values.push('mean $'+summary.costUsd.mean);
  if(summary.latencyMs?.p95!==undefined)values.push('p95 '+summary.latencyMs.p95+' ms');
  if(summary.negativeTransferRate!==undefined)values.push('negative transfer '+(summary.negativeTransferRate*100).toFixed(1)+'%');
  return values;
}

function selectionRole(card){
  return (card.scoreExplanation||[]).find((line)=>line.startsWith('Selection role:'))||'Selection role: deterministic ranked result.';
}

function renderCards(cards){
  results.replaceChildren();detail.hidden=true;results.hidden=false;
  if(!cards.length){
    const box=node('div','empty');
    box.append(node('p','eyebrow','NO COMPATIBLE RESULTS'),node('h2','','No public experience matched'),node('p','','Try broader terms or remove a Model/Harness, evidence, risk, license, cost, or latency filter. Unknown compatibility is never presented as exact.'));
    results.append(box);return;
  }
  cards.forEach((card)=>{
    const article=node('article','card');
    const meta=node('div','card-meta');
    meta.append(node('span','',card.compatibility+' · '+card.maxEvidenceLevel),node('span','','revision '+card.revision));
    const heading=node('h3');
    const link=node('a','',card.title);link.href='/?experience='+encodeURIComponent(card.experienceId);heading.append(link);
    article.append(meta,heading,node('p','',card.summary),node('p','boundary',selectionRole(card)));
    if(card.negativeCaseSummary)article.append(node('p','boundary','Nearby negative/boundary: '+card.negativeCaseSummary));
    const metrics=metricLines(card.metricSummary);
    if(metrics.length)article.append(node('p','boundary','Observed metrics: '+metrics.join(' · ')));
    const tags=node('div','tags');
    card.taskFamilies.slice(0,4).forEach((value)=>tags.append(tag(value)));
    tags.append(tag(card.sourceSummary));
    article.append(tags);results.append(article);
  });
}

async function search(){
  const params=new URLSearchParams();
  [['q','q'],['task','taskFamily'],['provider','modelProvider'],['model','modelId'],['harness-config','harnessConfigurationDigest'],['harness-snapshot','harnessManifestDigest'],['evidence','minEvidenceLevel'],['risk','maxRiskClass'],['license','license'],['cost','maxMeanCostUsd'],['latency','maxP95LatencyMs']].forEach(([id,key])=>{
    const value=document.querySelector('#'+id).value.trim();if(value)params.append(key,value);
  });
  results.innerHTML='<div class="empty"><p class="eyebrow">VERIFYING INDEX</p><h2>Loading signed experiences…</h2></div>';
  const response=await fetch('/v1/experiences?'+params);
  if(!response.ok)throw new Error(await response.text());
  renderCards((await response.json()).cards);
}

form.addEventListener('submit',(event)=>{event.preventDefault();history.pushState({},'',location.pathname);search().catch(showError)});

function listSection(title,items,classes=''){
  const section=node('section','detail-section '+classes);section.append(node('h3','',title));
  const list=node('ul');(items||[]).forEach((item)=>list.append(node('li','',item)));section.append(list);return section;
}

function evidenceBoundary(experience){
  const levels=experience.claims.map((claim)=>claim.evidenceLevel);
  const maximum=levels.sort((left,right)=>(evidenceRank[right]??-1)-(evidenceRank[left]??-1))[0]||'H0';
  const proves={
    H0:'A human- or agent-authored candidate claim exists and is reviewable.',
    H1:'The claim is supported by an observed execution trace for the stated task boundary.',
    H2:'The observed execution is locally correlated with a complete captured Model × Harness configuration surface.',
    H3:'A controlled comparative evaluation supports a treatment effect within the declared benchmark and configuration cells.',
    H4:'An independent evaluator or publisher replicated the declared result within its stated boundary.'
  };
  const doesNot={
    H0:'No execution success, configuration fidelity, causality, or transferability is established.',
    H1:'Trace evidence alone does not establish complete Harness configuration, causality, or general transfer.',
    H2:'Configuration reconstruction does not establish that a specific Skill or setting caused the outcome, nor that it transfers to another cell.',
    H3:'A controlled result is not universal across untested models, Harness versions, environments, tasks, or costs.',
    H4:'Independent replication still applies only to the published task, configuration, metric, and governance boundary.'
  };
  return {maximumEvidenceLevel:maximum,whatThisSupports:proves[maximum],whatThisDoesNotProve:doesNot[maximum]};
}

function renderDetail(experience,contentions,manifest,configurationDigest){
  results.hidden=true;detail.hidden=false;detail.replaceChildren();
  const head=node('header','detail-head');const back=node('a','back','← Back to public index');back.href='/';
  head.append(back,node('p','eyebrow',experience.kind+' · '+experience.claims.map((claim)=>claim.evidenceLevel).join('/')),node('h2','',experience.title),node('p','',experience.summary));detail.append(head);
  const grid=node('div','detail-grid');
  grid.append(listSection('Intended use',experience.intendedUses),listSection('Out of scope',experience.outOfScopeUses,'warning'),listSection('Known limitations',experience.knownLimitations),listSection('Known failure modes',experience.knownFailureModes,'warning'));
  const boundary=node('section','detail-section wide warning');
  boundary.append(node('h3','','Evidence boundary — what this proves / does not prove'),node('pre','',JSON.stringify(evidenceBoundary(experience),null,2)));grid.append(boundary);
  const surface=node('section','detail-section wide '+(!manifest?'warning':''));
  surface.append(node('h3','','Model × Harness surface coverage'));
  surface.append(node('pre','',JSON.stringify(manifest?{configurationDigest:manifest.configurationDigest,manifestDigest:manifest.digest,harness:manifest.harness,modelSurface:manifest.modelSurface,coverage:manifest.coverage,artifacts:manifest.artifacts,policies:manifest.policies,environment:manifest.environment}:{configurationDigest:configurationDigest||undefined,status:'Referenced public Harness Manifest snapshot was not available. The stable configuration selector alone does not prove complete snapshot coverage.'},null,2)));grid.append(surface);
  if(experience.metricSummary){const metrics=node('section','detail-section wide');metrics.append(node('h3','','Observed quality, cost, latency, and transfer metrics'),node('pre','',JSON.stringify(experience.metricSummary,null,2)));grid.append(metrics)}
  const claims=node('section','detail-section wide');claims.append(node('h3','','Claims and evidence'));
  experience.claims.forEach((claim)=>{claims.append(node('p','',claim.statement+' ['+claim.mode+' · '+claim.evidenceLevel+']'),node('pre','',JSON.stringify({scope:claim.scope,supportingEvidenceRefs:claim.supportingEvidenceRefs,contradictingEvidenceRefs:claim.contradictingEvidenceRefs,falsificationConditions:claim.falsificationConditions},null,2)))});grid.append(claims);
  const disputes=node('section','detail-section wide '+(contentions.length?'warning':''));
  disputes.append(node('h3','','Supporting and contradicting observations'),node('pre','',JSON.stringify(contentions.length?contentions:{status:'No public Contention object currently indexed. Original contradicting refs remain visible in each claim.'},null,2)));grid.append(disputes);
  if(experience.recipe){const recipe=node('section','detail-section wide');recipe.append(node('h3','','Human-reviewed recipe — untrusted data, never auto-executed'),node('p','',experience.recipe.strategy),node('pre','',JSON.stringify(experience.recipe,null,2)));grid.append(recipe)}
  if(experience.cases){const cases=node('section','detail-section wide');cases.append(node('h3','','Positive and negative cases'),node('pre','',JSON.stringify(experience.cases,null,2)));grid.append(cases)}
  const governance=node('section','detail-section wide');governance.append(node('h3','','Governance, source, and compatibility selectors'),node('pre','',JSON.stringify({applicability:experience.applicability,governance:experience.governance,publisher:experience.publisher,digest:experience.digest},null,2)));grid.append(governance);detail.append(grid);
}

function showError(error){
  results.hidden=false;detail.hidden=true;results.replaceChildren();
  const box=node('div','empty warning');box.append(node('p','eyebrow','REQUEST FAILED'),node('h2','','The Hub could not complete this read'),node('p','',error.message));results.append(box);
}

async function route(){
  const id=new URL(location.href).searchParams.get('experience');if(!id)return;
  const response=await fetch('/v1/experience?id='+encodeURIComponent(id));if(!response.ok)throw new Error(await response.text());
  const experience=await response.json();if(experience.tombstone)throw new Error('This revision has been withdrawn: '+experience.reasonCode);
  const selectors=experience.applicability?.harnessSelectors||[];
  const snapshotSelector=selectors.find((item)=>item.path==='harness.manifestDigest'&&typeof item.value==='string');
  const configurationSelector=selectors.find((item)=>item.path==='harness.configurationDigest'&&typeof item.value==='string');
  const provenanceManifest=(experience.relations||[]).find((relation)=>relation.target?.objectType==='harness_manifest'&&typeof relation.target?.digest==='string');
  const snapshotDigest=snapshotSelector?.value||provenanceManifest?.target?.digest;
  const [contentionResponse,manifestResponse]=await Promise.all([fetch('/v1/contentions?experienceId='+encodeURIComponent(id)),snapshotDigest?fetch('/v1/manifests/'+encodeURIComponent(snapshotDigest)):Promise.resolve(undefined)]);
  const contentionValue=contentionResponse.ok?await contentionResponse.json():{contentions:[]};
  const manifest=manifestResponse?.ok?await manifestResponse.json():undefined;
  renderDetail(experience,contentionValue.contentions||[],manifest,configurationSelector?.value);
}

route().catch(showError);
`

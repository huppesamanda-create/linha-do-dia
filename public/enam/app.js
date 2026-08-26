
(() => {
  const DATA = window.ENAM_DATA;
  const $ = (s, r=document) => r.querySelector(s);
  const $$ = (s, r=document) => [...r.querySelectorAll(s)];
  const uid = (p='id') => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,8)}`;
  const iso = () => new Date().toISOString();
  const localDateKey = (d=new Date()) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const fmtMinutes = m => m < 60 ? `${Math.round(m)} min` : `${Math.floor(m/60)}h${Math.round(m%60) ? ` ${Math.round(m%60)}min` : ''}`;
  const fmtPct = (a,b) => b ? Math.round((a/b)*100) : 0;
  const esc = s => String(s ?? '').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const addDays = (date, days) => { const d=new Date(date); d.setDate(d.getDate()+days); return d.toISOString(); };
  const subjectById = id => DATA.syllabus.find(s=>s.id===id);
  const subjectIdFromTitle = title => {
    const map={'Direito Constitucional':'constitucional','Direito Administrativo':'administrativo','Formação Humanística':'humanistica','Direitos Humanos':'direitos-humanos','Processo Civil':'processo-civil','Direito Civil':'civil','Direito Empresarial':'empresarial','Direito Penal':'penal'};
    return map[title] || '';
  };

  const defaultState = () => ({
    version:1,
    settings:{examDate:DATA.exam.date,sessionMinutes:50,targetScore:62,maxDailyBlocks:2},
    cycle:{number:1,completed:[],history:[]},
    syllabus:{}, laws:{}, questions:{}, sessions:[], activeTimer:null, simulations:[],
    notes:{jurisprudence:[]},
  });

  let state = defaultState();
  let page = 'today';
  let meta = {authenticated:true,persistence:'local'};
  let saveTimer = null;
  let clockInterval = null;
  let timerModalOpen = false;
  let mobileSidebarOpen = false;

  function mergeState(input){
    const base=defaultState();
    if(!input || typeof input!=='object') return base;
    return {...base,...input,settings:{...base.settings,...input.settings},cycle:{...base.cycle,...input.cycle},syllabus:input.syllabus||{},laws:input.laws||{},questions:input.questions||{},sessions:Array.isArray(input.sessions)?input.sessions:[],simulations:Array.isArray(input.simulations)?input.simulations:[],notes:{...base.notes,...input.notes}};
  }

  async function api(path, options={}){
    const res=await fetch(path,{credentials:'same-origin',headers:{'Content-Type':'application/json',...(options.headers||{})},...options});
    if(!res.ok){const err=new Error(`HTTP ${res.status}`); err.status=res.status; throw err;} return res.json();
  }

  async function boot(){
    try{meta=await api('/api/enam/meta');}
    catch{meta={authenticated:true,persistence:'local',authRequired:false};}
    if(meta.authRequired && !meta.authenticated){showLogin();return;}
    await loadState(); showApp(); initEvents(); render(); startClock();
  }

  async function loadState(){
    if(meta.persistence==='database' || meta.persistence==='file'){
      try{state=mergeState(await api('/api/enam/state')); return;}catch(e){if(e.status===401){showLogin();return;}}
    }
    try{state=mergeState(JSON.parse(localStorage.getItem('enam_portal_state_v1')||'null'));}catch{state=defaultState();}
  }

  function saveState(){
    $('#saveStatus').textContent='salvando…';
    clearTimeout(saveTimer);
    saveTimer=setTimeout(async()=>{
      try{
        if(meta.persistence==='database' || meta.persistence==='file') await api('/api/enam/state',{method:'PUT',body:JSON.stringify(state)});
        else localStorage.setItem('enam_portal_state_v1',JSON.stringify(state));
        $('#saveStatus').textContent='salvo';
      }catch{$('#saveStatus').textContent='erro ao salvar';}
    },400);
  }

  function showLogin(){ $('#loginScreen').classList.remove('hidden'); $('#app').classList.add('hidden'); }
  function showApp(){ $('#loginScreen').classList.add('hidden'); $('#app').classList.remove('hidden'); }

  function initEvents(){
    $('#nav').addEventListener('click',e=>{const b=e.target.closest('[data-page]');if(!b)return;go(b.dataset.page);});
    $('.sidebar-bottom').addEventListener('click',e=>{const b=e.target.closest('[data-page]');if(b)go(b.dataset.page);});
    $('#mobileMenu').onclick=()=>$('.portal-nav-wrap').classList.toggle('open');
    $('#timerPill').onclick=()=>openTimerModal();
    $('#loginForm').onsubmit=async e=>{e.preventDefault();$('#loginError').textContent='';try{await api('/api/enam/login',{method:'POST',body:JSON.stringify({password:$('#loginPassword').value})});location.reload();}catch{$('#loginError').textContent='Senha incorreta.';}};
  }

  function go(p){page=p;$$('[data-page]').forEach(b=>b.classList.toggle('active',b.dataset.page===p));$('.portal-nav-wrap').classList.remove('open');render();window.scrollTo({top:0,behavior:'smooth'});}
  const titles={today:'Hoje',cycle:'Ciclo de estudos',syllabus:'Conteúdo do edital',questions:'Questões FGV',laws:'Lei seca',review:'Revisão',performance:'Desempenho',settings:'Ajustes'};

  function render(){
    $('#pageTitle').textContent=titles[page]||'ENAM';
    const map={today:renderToday,cycle:renderCycle,syllabus:renderSyllabus,questions:renderQuestions,laws:renderLaws,review:renderReview,performance:renderPerformance,settings:renderSettings};
    $('#main').innerHTML=`<div class="page">${map[page]()}</div>`;
    bindPageEvents(); updateTopbar();
  }

  function updateTopbar(){
    const exam=new Date(`${state.settings.examDate}T13:00:00-03:00`); const now=new Date(); const days=Math.max(0,Math.ceil((exam-now)/86400000));
    $('#countdown').textContent=`${days} dias para a prova`;
    const active=state.activeTimer;
    $('#timerPill').classList.toggle('hidden',!active);
    if(active){$('#timerPillSubject').textContent=active.subject||active.title||'Foco';updateClockText();}
  }

  function phase(){
    const now=new Date(), exam=new Date(`${state.settings.examDate}T13:00:00-03:00`), days=(exam-now)/86400000;
    if(days<=14) return {id:'reta-final',name:'Reta final',desc:'Simulados completos, caderno de erros, lei seca e reparos cirúrgicos.',recipe:[['10','revisão'],['35','questões'],['5','erros']]};
    if(days<=30) return {id:'questoes',name:'Questões em primeiro plano',desc:'Menos aquisição e mais aplicação, jurisprudência e correção de erro.',recipe:[['10','conteúdo'],['35','questões'],['5','erros']]};
    if(days<=60) return {id:'consolidacao',name:'Consolidação',desc:'Conteúdo dirigido e volume crescente de questões.',recipe:[['20','conteúdo'],['25','questões'],['5','registro']]};
    return {id:'base',name:'Construção de base',desc:'Aquisição dirigida sem abandonar questões desde o primeiro ciclo.',recipe:[['30','conteúdo'],['15','questões'],['5','registro']]};
  }

  function cycleStatus(){
    const done=new Set(state.cycle.completed); const blocks=DATA.cycleBlocks;
    const next=blocks.find(b=>!done.has(b.id)) || blocks[0];
    return {done,next,completed:done.size,total:blocks.length};
  }
  function syllabusStats(){const items=DATA.syllabus.flatMap(s=>s.items);const done=items.filter(i=>state.syllabus[i.id]?.done).length;return {done,total:items.length,pct:fmtPct(done,items.length)};}
  function questionStats(){const all=Object.values(state.questions).filter(a=>a.submitted && !a.annulled);const correct=all.filter(a=>a.correct).length;return {answered:all.length,correct,pct:fmtPct(correct,all.length)};}
  function sessionMinutes(filterFn=()=>true){return state.sessions.filter(filterFn).reduce((a,s)=>a+(s.effectiveMinutes||0),0);}
  function startOfWeek(){const d=new Date();const day=(d.getDay()+6)%7;d.setHours(0,0,0,0);d.setDate(d.getDate()-day);return d;}
  function todaySessions(){const k=localDateKey();return state.sessions.filter(s=>localDateKey(new Date(s.endedAt||s.startedAt))===k);}
  function dueReviews(){const now=Date.now();return Object.entries(state.questions).filter(([,a])=>a.submitted && !a.correct && a.dueAt && new Date(a.dueAt).getTime()<=now);}

  function renderToday(){
    const c=cycleStatus(), sy=syllabusStats(), qs=questionStats(), ph=phase();
    const todayMin=sessionMinutes(s=>localDateKey(new Date(s.endedAt||s.startedAt))===localDateKey());
    const weekStart=startOfWeek();const weekMin=sessionMinutes(s=>new Date(s.endedAt||s.startedAt)>=weekStart);
    const reviews=dueReviews(); const blocksToday=todaySessions().filter(s=>s.kind==='cycle').length;
    const next=c.next;
    return `
      <div class="page-head"><div><div class="eyebrow">preparação enxuta · execução por ciclo</div><h1>O que importa agora</h1><p>Você não precisa montar a semana. Termine o próximo bloco, registre o que estudou e deixe o sistema guardar o resto.</p></div></div>
      ${meta.persistence!=='database'?`<div class="notice">Esta visualização está em modo ${meta.persistence==='local'?'local':'arquivo'}. Para uso definitivo no Railway, conecte um PostgreSQL para que o histórico fique persistente.</div>`:''}
      <div class="grid grid-4">
        ${stat('estudo hoje',fmtMinutes(todayMin),`${todaySessions().length} sessões`)}
        ${stat('esta semana',fmtMinutes(weekMin),'tempo líquido registrado')}
        ${stat('edital',`${sy.done}/${sy.total}`,`${sy.pct}% percorrido`)}
        ${stat('questões',qs.answered?`${qs.pct}%`:'—',qs.answered?`${qs.correct}/${qs.answered} acertos`:'ainda sem respostas')}
      </div>
      <div class="hero-session">
        <section class="card next-card">
          <div class="eyebrow">próximo bloco · ciclo ${state.cycle.number}</div>
          <h2>${esc(next.title)}</h2>
          <div class="mode">${esc(next.mode)}</div>
          <p>${esc(next.objective)}</p>
          <div class="next-meta"><div>ordem<strong>${next.order} de ${DATA.cycleBlocks.length}</strong></div><div>duração<strong>${state.settings.sessionMinutes} min</strong></div><div>ritmo normal<strong>até ${state.settings.maxDailyBlocks} blocos/dia</strong></div></div>
          <div class="header-actions"><button class="button primary" data-action="start-block" data-id="${next.id}">Iniciar ${state.settings.sessionMinutes} min</button><button class="button" data-action="open-syllabus" data-subject="${next.subjectId}">Ver edital da matéria</button></div>
          ${blocksToday>=state.settings.maxDailyBlocks?`<p class="soft-note" style="margin-bottom:0">Você já completou ${blocksToday} blocos hoje. O teto diário é uma proteção de energia, não uma meta a ultrapassar.</p>`:''}
        </section>
        <section class="card phase-card"><div><div class="eyebrow">fase atual</div><div class="phase-title">${ph.name}</div><p class="soft-note">${ph.desc}</p><div class="phase-recipe">${ph.recipe.map(r=>`<div class="recipe-part"><strong>${r[0]}</strong><span>min · ${r[1]}</span></div>`).join('')}</div></div><div><div class="divider"></div><div class="soft-note">O formato muda sozinho conforme a prova se aproxima. O ciclo continua sendo a espinha dorsal.</div></div></section>
      </div>
      <div class="section-title"><div><h2>Painel de margem</h2><p>O objetivo não é 80/80. É chegar ao corte com folga.</p></div></div>
      <div class="grid grid-2">
        <section class="card"><div class="score-band"><div class="score-point"><span>diagnóstico</span><strong>47/80</strong></div><div class="score-point"><span>corte</span><strong>56/80</strong></div><div class="score-point"><span>meta de segurança</span><strong>62–64</strong></div></div></section>
        <section class="card"><div class="today-list">
          ${todayRow('↻','Ciclo',`${c.completed}/${c.total} blocos concluídos`,`${fmtPct(c.completed,c.total)}%`)}
          ${todayRow('↺','Revisões',reviews.length?`${reviews.length} questões vencidas para revisar`:'nenhuma revisão vencida',reviews.length?'ver':'ok','review')}
          ${todayRow('?','Banco FGV',`${320-qs.answered} questões ainda disponíveis`,'treinar','questions')}
        </div></section>
      </div>`;
  }
  function stat(label,value,small){return `<div class="card stat"><span class="label">${label}</span><strong>${value}</strong><small>${small}</small></div>`;}
  function todayRow(icon,title,sub,action,target=''){return `<div class="today-row"><div class="today-icon">${icon}</div><div><strong>${title}</strong><small>${sub}</small></div>${target?`<button class="button small" data-go="${target}">${action}</button>`:`<span class="chip">${action}</span>`}</div>`;}

  function renderCycle(){
    const c=cycleStatus();
    return `<div class="page-head"><div><div class="eyebrow">sem dias fixos</div><h1>Ciclo de estudos</h1><p>Se o escritório ocupar dois dias, o plano não quebra. Você retoma exatamente do próximo bloco.</p></div><div class="header-actions"><button class="button" data-action="new-cycle">Novo ciclo</button></div></div>
      <div class="grid grid-4">${stat('ciclo atual',state.cycle.number,'sequência contínua')}${stat('progresso',`${c.completed}/${c.total}`,`${fmtPct(c.completed,c.total)}% do ciclo`)}${stat('carga líquida',`${Math.round(DATA.cycleBlocks.length*state.settings.sessionMinutes/60)}h`,'por ciclo completo')}${stat('limite diário',state.settings.maxDailyBlocks,'blocos em dia normal')}</div>
      <div class="section-title"><div><h2>Sequência</h2><p>O próximo bloco é realçado. Concluir o timer encerra o bloco e abre o registro do edital.</p></div></div>
      <div class="cycle-list">${DATA.cycleBlocks.map(b=>cycleBlockHtml(b,c)).join('')}</div>`;
  }
  function cycleBlockHtml(b,c){const done=c.done.has(b.id), current=c.next.id===b.id;return `<div class="cycle-block ${done?'done':''} ${current?'current':''}"><div class="cycle-number">${done?'✓':b.order}</div><div class="cycle-main"><strong>${esc(b.title)}</strong><span>${esc(b.mode)} · ${esc(b.objective)}</span></div><div class="cycle-actions">${!done?`<button class="button small ${current?'primary':''}" data-action="start-block" data-id="${b.id}">Iniciar</button>`:''}<button class="button small" data-action="open-syllabus" data-subject="${b.subjectId}">Edital</button></div></div>`;}

  function renderSyllabus(){
    const sy=syllabusStats();
    return `<div class="page-head"><div><div class="eyebrow">anexo I · 134 itens</div><h1>Conteúdo do edital</h1><p>Marque o que foi efetivamente percorrido. Use “revisar” para separar cobertura de domínio.</p></div></div>
      <div class="grid grid-4">${stat('cobertura',`${sy.pct}%`,`${sy.done}/${sy.total} itens`)}${stat('a revisar',Object.values(state.syllabus).filter(x=>x.review).length,'itens sinalizados')}${stat('seguros',Object.values(state.syllabus).filter(x=>x.confidence==='seguro').length,'confiança alta')}${stat('jurisprudência','todas','súmulas, repetitivos e entendimento dominante')}</div>
      <div class="filters" style="margin-top:18px"><input id="syllabusSearch" class="search" placeholder="Buscar tema no edital…"><select id="syllabusStatus" class="select"><option value="all">todos</option><option value="todo">não estudados</option><option value="done">estudados</option><option value="review">marcados para revisar</option></select></div>
      <div id="syllabusList">${syllabusListHtml()}</div>`;
  }
  function syllabusListHtml(search='',status='all'){
    const q=search.trim().toLowerCase();
    return DATA.syllabus.map(s=>{
      const items=s.items.filter(i=>{const st=state.syllabus[i.id]||{};if(status==='todo'&&st.done)return false;if(status==='done'&&!st.done)return false;if(status==='review'&&!st.review)return false;return !q||`${i.label} ${i.full}`.toLowerCase().includes(q);});
      if(!items.length)return '';
      const d=s.items.filter(i=>state.syllabus[i.id]?.done).length;const pct=fmtPct(d,s.items.length);
      return `<section class="card subject-card" data-subject-card="${s.id}"><div class="subject-head" data-toggle-subject><div><h3>${esc(s.title)}</h3><small>${d}/${s.items.length} itens estudados</small></div><div class="subject-progress"><div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div><small>${pct}%</small></div></div><div class="subject-body">${items.map(i=>syllabusItemHtml(i)).join('')}</div></section>`;
    }).join('') || `<div class="card empty">Nenhum item com esse filtro.</div>`;
  }
  function syllabusItemHtml(i){const st=state.syllabus[i.id]||{};return `<div class="syllabus-item" data-syllabus-item="${i.id}"><button class="check ${st.done?'checked':''}" data-action="toggle-syllabus" data-id="${i.id}">${st.done?'✓':''}</button><div><div class="syllabus-title"><span style="color:var(--muted);margin-right:5px">${i.number}.</span>${esc(i.label)}</div><div class="syllabus-full">${esc(i.full)}</div></div><div class="item-tools"><button class="chip ${st.review?'active':''}" data-action="review-syllabus" data-id="${i.id}">revisar</button><button class="chip ${st.confidence==='seguro'?'active':''}" data-action="confidence-syllabus" data-id="${i.id}">${st.confidence==='seguro'?'seguro':st.confidence==='medio'?'médio':'confiança'}</button><button class="chip" data-action="expand-syllabus" data-id="${i.id}">texto</button></div></div>`;}

  function renderQuestions(){
    const qs=questionStats();
    return `<div class="page-head"><div><div class="eyebrow">1º ao 4º ENAM · tipo 1</div><h1>Questões FGV</h1><p>O original fica no caderno oficial. Aqui você registra resposta, grau de certeza, método de chute e erros para revisão.</p></div><div class="header-actions"><button class="button soft" data-action="guided-guess">Laboratório do chute</button></div></div>
      <div class="grid grid-4">${stat('respondidas',qs.answered,'de 320 disponíveis')}${stat('acertos',qs.answered?`${qs.pct}%`:'—',qs.answered?`${qs.correct} corretas`:'comece por um caderno novo')}${stat('chute orientado',guessStat('guided'),'taxa de acerto')}${stat('chute puro',guessStat('pure'),'taxa de acerto')}</div>
      <div class="filters" style="margin-top:18px"><select id="qExam" class="select"><option value="all">todos os exames</option><option value="1">1º ENAM</option><option value="2">2º ENAM</option><option value="3">3º ENAM</option><option value="4">4º ENAM</option></select><select id="qSubject" class="select"><option value="all">todas as matérias</option>${DATA.syllabus.map(s=>`<option value="${s.id}">${esc(s.title)}</option>`).join('')}</select><select id="qStatus" class="select"><option value="unanswered">não respondidas</option><option value="all">todas</option><option value="wrong">erros</option><option value="correct">acertos</option></select><button class="button" data-action="random-question">Questão aleatória</button></div>
      <div id="questionList" class="cycle-list">${questionListHtml()}</div>`;
  }
  function guessStat(mode){const all=Object.values(state.questions).filter(a=>a.submitted&&a.confidence===mode&&!a.annulled);if(!all.length)return '—';return `${fmtPct(all.filter(a=>a.correct).length,all.length)}%`;}
  function questionListHtml(exam='all',subject='all',status='unanswered'){
    let arr=DATA.questions.filter(q=>exam==='all'||String(q.examNumber)===String(exam)).filter(q=>subject==='all'||q.subjectId===subject).filter(q=>{const a=state.questions[q.id];if(status==='unanswered')return !a?.submitted;if(status==='wrong')return a?.submitted&&!a.correct&&!q.annulled;if(status==='correct')return a?.submitted&&a.correct;return true;});
    arr=arr.slice(0,80);
    if(!arr.length)return `<div class="card empty">Nenhuma questão com esse filtro.</div>`;
    return arr.map(q=>{const a=state.questions[q.id];let badge='<div class="answer-badge">—</div>';if(q.annulled)badge='<div class="answer-badge annul">*</div>';else if(a?.submitted)badge=`<div class="answer-badge ${a.correct?'ok':'wrong'}">${a.correct?'✓':'×'}</div>`;return `<div class="question-card"><div class="q-number">Q${q.number}<small>${q.exam}</small></div><div><strong>${esc(q.subject)}</strong><span class="meta">${a?.submitted?`Sua resposta: ${a.answer} · ${confidenceLabel(a.confidence)}`:'ainda não respondida'}</span></div><div style="display:flex;gap:7px;align-items:center">${badge}<button class="button small" data-action="open-question" data-id="${q.id}">${a?.submitted?'ver':'responder'}</button></div></div>`;}).join('');
  }
  function confidenceLabel(v){return ({knew:'sabia',between:'entre duas',guided:'chute orientado',pure:'chute puro'})[v]||'sem classificação';}

  function renderLaws(){
    const done=DATA.laws.filter(l=>state.laws[l.id]?.status==='done').length;
    const p1=DATA.laws.filter(l=>l.priority===1), p1done=p1.filter(l=>state.laws[l.id]?.status==='done').length;
    return `<div class="page-head"><div><div class="eyebrow">inventário extraído das provas</div><h1>Lei seca</h1><p>Nem toda norma merece o mesmo tempo. A prioridade combina recorrência nas provas, centralidade no edital e tamanho do diploma.</p></div></div>
      <div class="grid grid-4">${stat('concluídas',`${done}/${DATA.laws.length}`,'normas do inventário')}${stat('prioridade máxima',`${p1done}/${p1.length}`,'núcleo de leitura')}${stat('CNJ',DATA.laws.filter(l=>l.type==='CNJ').length,'resoluções e recomendações')}${stat('tratados',DATA.laws.filter(l=>l.type==='Tratado').length,'direitos humanos e penal')}</div>
      <div class="filters" style="margin-top:18px"><input id="lawSearch" class="search" placeholder="Buscar norma…"><select id="lawPriority" class="select"><option value="all">todas as prioridades</option><option value="1">prioridade máxima</option><option value="2">alta</option><option value="3">dirigida</option></select><select id="lawStatus" class="select"><option value="all">todos os status</option><option value="todo">não iniciadas</option><option value="reading">em leitura</option><option value="done">concluídas</option></select></div>
      <div id="lawList" class="law-list">${lawListHtml()}</div>`;
  }
  function lawListHtml(search='',priority='all',status='all'){
    const q=search.toLowerCase();return DATA.laws.filter(l=>(priority==='all'||String(l.priority)===priority)&&(!q||`${l.name} ${l.subject} ${l.note}`.toLowerCase().includes(q))).filter(l=>status==='all'||(state.laws[l.id]?.status||'todo')===status).map(l=>{const st=state.laws[l.id]?.status||'todo';return `<div class="law-row"><button class="check ${st==='done'?'checked':''}" data-action="cycle-law" data-id="${l.id}">${st==='done'?'✓':st==='reading'?'•':''}</button><div><div class="law-name">${esc(l.name)}</div><div class="law-note">${esc(l.note)}</div></div><div><span class="priority p${l.priority}">${l.priority===1?'prioridade máxima':l.priority===2?'alta':'dirigida'}</span><div class="law-note">${esc(l.subject)}</div></div><div class="law-note">${esc(l.mode)}</div></div>`;}).join('')||`<div class="card empty">Nenhuma norma com esse filtro.</div>`;
  }

  function renderReview(){
    const due=dueReviews();const sy=DATA.syllabus.flatMap(s=>s.items.map(i=>({...i,subject:s.title}))).filter(i=>state.syllabus[i.id]?.review);
    return `<div class="page-head"><div><div class="eyebrow">caderno de erros + itens sinalizados</div><h1>Revisão</h1><p>Revisar é fechar a lacuna que apareceu no estudo ou na questão, não reler tudo.</p></div></div>
      <div class="grid grid-4">${stat('questões vencidas',due.length,'erros com revisão hoje')}${stat('itens do edital',sy.length,'marcados para revisar')}${stat('revisões feitas',Object.values(state.questions).reduce((a,x)=>a+(x.reviewStage||0),0),'etapas registradas')}${stat('regra','1 · 3 · 7 · 14','dias após erro')}</div>
      <div class="section-title"><div><h2>Questões para revisar</h2></div></div>
      <div class="review-list">${due.length?due.map(([id,a])=>{const q=DATA.questions.find(x=>x.id===id);return `<div class="review-item"><div><strong>${q.exam} · Q${q.number} · ${esc(q.subject)}</strong><small>Você marcou ${a.answer}; gabarito ${q.answer}. Etapa ${a.reviewStage||0}.</small></div><button class="button small" data-action="review-question" data-id="${id}">Revisar</button></div>`;}).join(''):`<div class="card empty">Nenhuma questão vencida para revisão.</div>`}</div>
      <div class="section-title"><div><h2>Edital marcado para revisar</h2></div></div>
      <div class="review-list">${sy.length?sy.map(i=>`<div class="review-item"><div><strong>${esc(i.subject)} · ${i.number}. ${esc(i.label)}</strong><small>${esc(i.full.slice(0,180))}${i.full.length>180?'…':''}</small></div><button class="button small" data-action="clear-syllabus-review" data-id="${i.id}">Revisado</button></div>`).join(''):`<div class="card empty">Nenhum item do edital marcado.</div>`}</div>`;
  }

  function renderPerformance(){
    const qs=questionStats();const sims=[{date:DATA.diagnostic.date,score:DATA.diagnostic.score,label:'Diagnóstico 5º ENAM'},...state.simulations];
    return `<div class="page-head"><div><div class="eyebrow">dados, não sensação</div><h1>Desempenho</h1><p>A preparação muda com o que os seus dados mostrarem. O ciclo inicial é uma hipótese; seus resultados decidem os próximos ajustes.</p></div><div class="header-actions"><button class="button" data-action="add-simulation">Registrar simulado</button></div></div>
      <div class="grid grid-4">${stat('diagnóstico','47/80','58,75%')}${stat('meta',`${state.settings.targetScore}/80`,'margem sobre o corte')}${stat('questões FGV',qs.answered?`${qs.pct}%`:'—',`${qs.answered} respondidas`)}${stat('horas líquidas',fmtMinutes(sessionMinutes(()=>true)),'desde o início')}</div>
      <div class="grid grid-2" style="margin-top:16px"><section class="card"><div class="eyebrow">diagnóstico por disciplina</div><h2 style="font:600 16px Raleway;margin:6px 0 14px">Pontos de partida</h2>${DATA.diagnostic.subjects.map(s=>`<div class="bar-row"><div class="bar-label">${esc(s.name)}</div><div class="bar-wrap"><div class="bar" style="width:${fmtPct(s.score,s.total)}%"></div></div><div class="bar-value">${s.score}/${s.total}</div></div>`).join('')}</section><section class="card"><div class="eyebrow">calibração da confiança</div><h2 style="font:600 16px Raleway;margin:6px 0 14px">Como você acerta</h2>${['knew','between','guided','pure'].map(k=>confidenceBar(k)).join('')}</section></div>
      <div class="section-title"><div><h2>Simulados</h2><p>O 5º ENAM permanece como diagnóstico; os próximos entram aqui.</p></div></div><section class="card"><table class="perf-table"><thead><tr><th>data</th><th>prova</th><th>resultado</th><th>percentual</th></tr></thead><tbody>${sims.map(s=>`<tr><td>${esc(s.date)}</td><td>${esc(s.label||'Simulado')}</td><td>${s.score}/80</td><td>${fmtPct(s.score,80)}%</td></tr>`).join('')}</tbody></table></section>`;
  }
  function confidenceBar(k){const all=Object.values(state.questions).filter(a=>a.submitted&&a.confidence===k&&!a.annulled);const correct=all.filter(a=>a.correct).length,p=fmtPct(correct,all.length);return `<div class="bar-row"><div class="bar-label">${confidenceLabel(k)}</div><div class="bar-wrap"><div class="bar" style="width:${p}%"></div></div><div class="bar-value">${all.length?p+'%':'—'}</div></div>`;}

  function renderSettings(){return `<div class="page-head"><div><div class="eyebrow">configuração mínima</div><h1>Ajustes</h1><p>O sistema foi feito para exigir pouca manutenção. Mexa apenas no que realmente mudou.</p></div></div><div class="settings-grid"><section class="card"><div class="field"><label>data da prova</label><input id="setExamDate" type="date" value="${state.settings.examDate}"></div><div class="field" style="margin-top:12px"><label>duração do bloco</label><input id="setMinutes" type="number" min="20" max="120" value="${state.settings.sessionMinutes}"></div><div class="field" style="margin-top:12px"><label>meta de segurança / 80</label><input id="setTarget" type="number" min="56" max="80" value="${state.settings.targetScore}"></div><div class="field" style="margin-top:12px"><label>máximo de blocos em dia normal</label><input id="setMaxBlocks" type="number" min="1" max="6" value="${state.settings.maxDailyBlocks}"></div><button class="button primary" style="margin-top:14px" data-action="save-settings">Salvar ajustes</button></section><section class="card"><div class="eyebrow">segurança dos dados</div><h2 style="font:600 16px Raleway">Backup</h2><p class="soft-note">Exporte seu estado quando quiser. Em produção, o PostgreSQL é a fonte principal e o arquivo funciona como backup portátil.</p><div class="header-actions" style="margin-top:14px"><button class="button" data-action="export-state">Exportar JSON</button><label class="button">Importar JSON<input id="importState" type="file" accept="application/json" hidden></label></div><div class="divider"></div><button class="button danger" data-action="reset-state">Zerar portal</button></section></div>`;}

  function bindPageEvents(){
    $$('[data-go]').forEach(b=>b.onclick=()=>go(b.dataset.go));
    $$('[data-action]').forEach(b=>b.onclick=e=>handleAction(b.dataset.action,b));
    if(page==='syllabus'){
      const refresh=()=>{$('#syllabusList').innerHTML=syllabusListHtml($('#syllabusSearch').value,$('#syllabusStatus').value);bindPageEvents();};
      $('#syllabusSearch').oninput=refresh;$('#syllabusStatus').onchange=refresh;
    }
    if(page==='questions'){
      const refresh=()=>{$('#questionList').innerHTML=questionListHtml($('#qExam').value,$('#qSubject').value,$('#qStatus').value);bindPageEvents();};
      $('#qExam').onchange=refresh;$('#qSubject').onchange=refresh;$('#qStatus').onchange=refresh;
    }
    if(page==='laws'){
      const refresh=()=>{$('#lawList').innerHTML=lawListHtml($('#lawSearch').value,$('#lawPriority').value,$('#lawStatus').value);bindPageEvents();};
      $('#lawSearch').oninput=refresh;$('#lawPriority').onchange=refresh;$('#lawStatus').onchange=refresh;
    }
    const imp=$('#importState');if(imp)imp.onchange=importState;
  }

  function handleAction(action,b){
    if(action==='start-block') return startBlock(b.dataset.id);
    if(action==='open-syllabus'){page='syllabus';render();setTimeout(()=>{const el=$(`[data-subject-card="${b.dataset.subject}"]`);if(el)el.scrollIntoView({behavior:'smooth',block:'start'});},80);return;}
    if(action==='new-cycle') return newCycle();
    if(action==='toggle-syllabus') return toggleSyllabus(b.dataset.id);
    if(action==='review-syllabus') return toggleSyllabusReview(b.dataset.id);
    if(action==='confidence-syllabus') return cycleSyllabusConfidence(b.dataset.id);
    if(action==='expand-syllabus') return b.closest('.syllabus-item').classList.toggle('expanded');
    if(action==='open-question') return openQuestion(b.dataset.id);
    if(action==='random-question') return openRandomQuestion(false);
    if(action==='guided-guess') return openRandomQuestion(true);
    if(action==='cycle-law') return cycleLaw(b.dataset.id);
    if(action==='review-question') return openQuestion(b.dataset.id,true);
    if(action==='clear-syllabus-review'){state.syllabus[b.dataset.id]={...(state.syllabus[b.dataset.id]||{}),review:false,lastReviewedAt:iso()};saveState();render();return;}
    if(action==='add-simulation') return addSimulationModal();
    if(action==='save-settings') return saveSettings();
    if(action==='export-state') return exportState();
    if(action==='reset-state') return resetState();
  }

  function startBlock(id){
    if(state.activeTimer){toast('Já existe um timer em andamento.');openTimerModal();return;}
    const b=DATA.cycleBlocks.find(x=>x.id===id);if(!b)return;
    state.activeTimer={id:uid('timer'),kind:'cycle',blockId:b.id,title:b.title,subject:b.subject,subjectId:b.subjectId,durationMinutes:state.settings.sessionMinutes,startedAt:iso(),pausedAt:null,pausedMs:0,status:'running'};saveState();openTimerModal();updateTopbar();
  }
  function startClock(){clearInterval(clockInterval);clockInterval=setInterval(()=>{updateTopbar();if(timerModalOpen)updateTimerModalClock();const t=state.activeTimer;if(t&&t.status==='running'&&timerRemainingMs(t)<=0){finishTimer(true);}},1000);}
  function timerElapsedMs(t){const end=t.status==='paused'?new Date(t.pausedAt):new Date();return Math.max(0,end-new Date(t.startedAt)-(t.pausedMs||0));}
  function timerRemainingMs(t){return Math.max(0,t.durationMinutes*60000-timerElapsedMs(t));}
  function clockString(ms){const s=Math.ceil(ms/1000);return `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;}
  function updateClockText(){if(!state.activeTimer)return;$('#timerPillClock').textContent=clockString(timerRemainingMs(state.activeTimer));}
  function openTimerModal(){if(!state.activeTimer)return;timerModalOpen=true;const t=state.activeTimer;modal(`<div class="timer-modal"><div class="eyebrow">sessão em andamento</div><h2 style="font:600 20px Raleway;margin:6px 0">${esc(t.title)}</h2><div class="timer-subject">${esc(t.subject)}</div><div id="timerBig" class="timer-big">${clockString(timerRemainingMs(t))}</div><div class="soft-note">Tempo líquido. Pausas não contam.</div><div class="timer-actions"><button id="pauseTimer" class="button">${t.status==='paused'?'Retomar':'Pausar'}</button><button id="finishTimer" class="button primary">Encerrar bloco</button><button id="cancelTimer" class="button danger">Cancelar</button></div></div>`,()=>{timerModalOpen=false;});$('#pauseTimer').onclick=togglePause;$('#finishTimer').onclick=()=>finishTimer(false);$('#cancelTimer').onclick=cancelTimer;}
  function updateTimerModalClock(){const el=$('#timerBig');if(el&&state.activeTimer)el.textContent=clockString(timerRemainingMs(state.activeTimer));}
  function togglePause(){const t=state.activeTimer;if(!t)return;if(t.status==='paused'){t.pausedMs=(t.pausedMs||0)+(Date.now()-new Date(t.pausedAt).getTime());t.pausedAt=null;t.status='running';}else{t.pausedAt=iso();t.status='paused';}saveState();closeModal();openTimerModal();}
  function cancelTimer(){if(!confirm('Cancelar esta sessão sem registrá-la?'))return;state.activeTimer=null;saveState();closeModal();render();}
  function finishTimer(auto=false){const t=state.activeTimer;if(!t)return;const elapsed=Math.min(t.durationMinutes*60000,timerElapsedMs(t));state.sessions.push({id:uid('session'),kind:t.kind,blockId:t.blockId||null,title:t.title,subject:t.subject,subjectId:t.subjectId,startedAt:t.startedAt,endedAt:iso(),effectiveMinutes:Math.max(1,Math.round(elapsed/60000))});state.activeTimer=null;if(t.kind==='cycle'&&!state.cycle.completed.includes(t.blockId))state.cycle.completed.push(t.blockId);saveState();closeModal();if(t.kind==='cycle')openClosureModal(t);else render();if(auto)chime();}
  function chime(){try{const ctx=new (window.AudioContext||window.webkitAudioContext)();const o=ctx.createOscillator(),g=ctx.createGain();o.connect(g);g.connect(ctx.destination);o.frequency.value=660;g.gain.value=.04;o.start();o.stop(ctx.currentTime+.18);}catch{}}
  function openClosureModal(t){
    const subject=subjectById(t.subjectId);if(!subject){toast('Bloco concluído.');render();return;}
    modal(`<div class="eyebrow">fechamento do bloco</div><h2 style="font:600 20px Raleway;margin:6px 0 4px">O que você percorreu?</h2><p class="soft-note">Marque apenas os itens do edital efetivamente cobertos nesta sessão. Isso separa tempo estudado de cobertura real.</p><div class="modal-checklist" style="margin-top:14px">${subject.items.map(i=>`<label class="modal-check-item"><input type="checkbox" value="${i.id}" ${state.syllabus[i.id]?.done?'checked':''}><span>${i.number}. ${esc(i.label)}</span></label>`).join('')}</div><div class="field" style="margin-top:14px"><label>nota rápida do bloco</label><textarea id="closureNote" placeholder="Ex.: dificuldade em modulação; revisar jurisprudência do STF."></textarea></div><div class="header-actions" style="margin-top:16px;justify-content:flex-end"><button id="saveClosure" class="button primary">Salvar e seguir</button></div>`);$('#saveClosure').onclick=()=>{const checked=$$('.modal-check-item input:checked').map(x=>x.value);checked.forEach(id=>state.syllabus[id]={...(state.syllabus[id]||{}),done:true,lastStudiedAt:iso()});const sess=state.sessions[state.sessions.length-1];sess.note=$('#closureNote').value.trim();saveState();closeModal();render();};
  }

  function toggleSyllabus(id){const cur=state.syllabus[id]||{};state.syllabus[id]={...cur,done:!cur.done,lastStudiedAt:!cur.done?iso():cur.lastStudiedAt};saveState();render();}
  function toggleSyllabusReview(id){const cur=state.syllabus[id]||{};state.syllabus[id]={...cur,review:!cur.review};saveState();render();}
  function cycleSyllabusConfidence(id){const cur=state.syllabus[id]||{};const next=cur.confidence==='medio'?'seguro':cur.confidence==='seguro'?'': 'medio';state.syllabus[id]={...cur,confidence:next};saveState();render();}
  function newCycle(){if(!confirm(`Encerrar o ciclo ${state.cycle.number} e iniciar o próximo?`))return;state.cycle.history.push({number:state.cycle.number,completed:[...state.cycle.completed],endedAt:iso()});state.cycle.number+=1;state.cycle.completed=[];saveState();render();}

  function openQuestion(id,review=false){const q=DATA.questions.find(x=>x.id===id);if(!q)return;const a=state.questions[id]||{};const submitted=a.submitted;
    modal(`<div class="eyebrow">${esc(q.exam)} · tipo 1</div><h2 style="font:600 20px Raleway;margin:6px 0">Questão ${q.number} · ${esc(q.subject)}</h2><p class="soft-note">Abra o caderno oficial, leia a questão e volte aqui para registrar sua resposta. O gabarito fica oculto até você confirmar.</p><div class="header-actions" style="margin:14px 0"><a class="button" href="${esc(q.testUrl)}" target="_blank" rel="noopener">Abrir caderno FGV</a></div>${submitted?questionResultHtml(q,a,review):questionAnswerForm(q,a)}</div>`);
    if(!submitted){$$('.answer-btn').forEach(b=>b.onclick=()=>{$$('.answer-btn').forEach(x=>x.classList.remove('selected'));b.classList.add('selected');b.dataset.selected='1';});$$('[data-confidence]').forEach(b=>b.onclick=()=>{$$('[data-confidence]').forEach(x=>x.classList.remove('active'));b.classList.add('active');});$$('[data-cue]').forEach(b=>b.onclick=()=>b.classList.toggle('active'));$('#submitQuestion').onclick=()=>submitQuestion(q);}
    if(submitted&&review){const rb=$('#markReviewed');if(rb)rb.onclick=()=>markReviewed(q.id);}
  }
  function questionAnswerForm(q,a){return `<div><div class="eyebrow">sua resposta</div><div class="answer-row">${['A','B','C','D','E'].map(x=>`<button class="answer-btn" data-answer="${x}">${x}</button>`).join('')}</div><div class="eyebrow" style="margin-top:16px">como você chegou nela?</div><div class="confidence-row">${[['knew','sabia a matéria'],['between','fiquei entre duas'],['guided','chute orientado'],['pure','chute puro']].map(([k,l])=>`<button class="chip" data-confidence="${k}">${l}</button>`).join('')}</div><div class="eyebrow" style="margin-top:16px">pistas usadas no chute · opcional</div><div class="cue-row">${['eliminação','qualificador/exceção','alcance da frase','coerência do sistema','I/II/III','competência/sujeito','prazo/número','formulação jurisprudencial'].map(c=>`<button class="chip" data-cue="${c}">${c}</button>`).join('')}</div><div class="field" style="margin-top:16px"><label>observação</label><textarea id="qNote" placeholder="O que te fez escolher essa alternativa?"></textarea></div><button id="submitQuestion" class="button primary" style="margin-top:15px">Confirmar resposta</button></div>`;}
  function questionResultHtml(q,a,review){const ann=q.annulled||q.answer==='*';return `<div class="card flat" style="background:var(--surface-2)"><div class="eyebrow">resultado</div><h3 style="font:600 18px Raleway;margin:6px 0">${ann?'Questão anulada':a.correct?'Acertou':'Errou'}</h3><p class="soft-note">Sua resposta: <strong>${a.answer}</strong> · Gabarito definitivo: <strong>${q.answer}</strong> · ${confidenceLabel(a.confidence)}.</p>${a.note?`<p class="soft-note">Sua nota: ${esc(a.note)}</p>`:''}${!a.correct&&!ann?`<p class="soft-note">Revisão programada: ${new Date(a.dueAt).toLocaleDateString('pt-BR')} · etapa ${a.reviewStage||0}.</p>`:''}${review&&!a.correct?`<button id="markReviewed" class="button primary" style="margin-top:10px">Marcar revisão feita</button>`:''}</div><div class="header-actions" style="margin-top:14px"><a class="button" href="${esc(q.keyUrl)}" target="_blank" rel="noopener">Abrir gabarito oficial</a></div>`;}
  function submitQuestion(q){const ans=$('.answer-btn.selected')?.dataset.answer;const conf=$('[data-confidence].active')?.dataset.confidence;if(!ans||!conf){toast('Marque a resposta e o grau de certeza.');return;}const ann=q.annulled||q.answer==='*';const correct=ann||ans===q.answer;state.questions[q.id]={answer:ans,confidence:conf,cues:$$('[data-cue].active').map(x=>x.dataset.cue),note:$('#qNote').value.trim(),submitted:true,correct,annulled:ann,answeredAt:iso(),reviewStage:correct?0:1,dueAt:correct?null:addDays(new Date(),1)};saveState();closeModal();openQuestion(q.id);render();}
  function markReviewed(id){const a=state.questions[id];if(!a)return;const stages=[1,3,7,14,30];const idx=Math.min((a.reviewStage||1),stages.length-1);a.reviewStage=(a.reviewStage||1)+1;a.dueAt=addDays(new Date(),stages[idx]);a.lastReviewedAt=iso();saveState();closeModal();render();toast('Revisão registrada.');}
  function openRandomQuestion(guided){const unanswered=DATA.questions.filter(q=>!state.questions[q.id]?.submitted);if(!unanswered.length){toast('Você já respondeu todo o banco.');return;}const q=unanswered[Math.floor(Math.random()*unanswered.length)];openQuestion(q.id);if(guided)setTimeout(()=>{const chip=$('[data-confidence="guided"]');if(chip)chip.classList.add('active');},20);}

  function cycleLaw(id){const cur=state.laws[id]?.status||'todo';const next=cur==='todo'?'reading':cur==='reading'?'done':'todo';state.laws[id]={...(state.laws[id]||{}),status:next,updatedAt:iso()};saveState();render();}

  function addSimulationModal(){modal(`<div class="eyebrow">simulado</div><h2 style="font:600 20px Raleway;margin:6px 0">Registrar resultado</h2><div class="field"><label>data</label><input id="simDate" type="date" value="${localDateKey()}"></div><div class="field" style="margin-top:12px"><label>identificação</label><input id="simLabel" placeholder="Ex.: 4º ENAM — repetição completa"></div><div class="field" style="margin-top:12px"><label>acertos / 80</label><input id="simScore" type="number" min="0" max="80"></div><div class="field" style="margin-top:12px"><label>nota</label><textarea id="simNote"></textarea></div><button id="saveSim" class="button primary" style="margin-top:15px">Salvar</button>`);$('#saveSim').onclick=()=>{const score=Number($('#simScore').value);if(!Number.isFinite(score)||score<0||score>80)return;state.simulations.push({id:uid('sim'),date:$('#simDate').value,label:$('#simLabel').value.trim()||'Simulado',score,note:$('#simNote').value.trim()});saveState();closeModal();render();};}
  function saveSettings(){state.settings.examDate=$('#setExamDate').value;state.settings.sessionMinutes=Math.max(20,Number($('#setMinutes').value)||50);state.settings.targetScore=Math.max(56,Number($('#setTarget').value)||62);state.settings.maxDailyBlocks=Math.max(1,Number($('#setMaxBlocks').value)||2);saveState();render();toast('Ajustes salvos.');}
  function exportState(){const blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`enam-backup-${localDateKey()}.json`;a.click();URL.revokeObjectURL(a.href);}
  function importState(e){const f=e.target.files?.[0];if(!f)return;const reader=new FileReader();reader.onload=()=>{try{const obj=JSON.parse(reader.result);state=mergeState(obj);saveState();render();toast('Backup importado.');}catch{toast('Arquivo inválido.');}};reader.readAsText(f);}
  function resetState(){if(!confirm('Isso apaga todo o progresso deste portal. Continuar?'))return;if(!confirm('Confirma novamente? Esta ação não pode ser desfeita sem backup.'))return;state=defaultState();saveState();render();}

  function modal(content,onClose){$('#modalRoot').innerHTML=`<div class="modal-backdrop"><div class="modal"><div class="modal-head"><div></div><button class="modal-close">×</button></div>${content}</div></div>`;$('.modal-close').onclick=()=>{closeModal();onClose?.();};$('.modal-backdrop').onclick=e=>{if(e.target===e.currentTarget){closeModal();onClose?.();}};}
  function closeModal(){timerModalOpen=false;$('#modalRoot').innerHTML='';}
  function toast(msg){const t=$('#toast');t.textContent=msg;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2200);}

  boot();
})();

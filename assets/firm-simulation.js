(function(){
 'use strict';
 var OM=window.OfficeManager;if(!OM||!OM.isOwner())return;
 var anchor=document.getElementById('area');if(!anchor)return;
 function el(tag,text){var n=document.createElement(tag);if(text!=null)n.textContent=text;return n;}
 var panel=el('section');panel.className='card';panel.id='firm-simulation';
 panel.appendChild(el('h2','Cabinet virtuel — 15 personnes, 24 mois'));
 panel.appendChild(el('p','Deux parcours séparés : référence gratuite pour vérifier le moteur ; IA pour mesurer les réponses des agents. Le score porte sur des contrôles structurels, pas sur la qualité complète d’un audit. Les personnages suivent des règles de scénario ; ce premier module ne teste pas encore les services métier de production.'));
 var controls=el('div');controls.className='links';panel.appendChild(controls);
 var status=el('p');status.setAttribute('role','status');status.setAttribute('aria-live','polite');panel.appendChild(status);
 var results=el('div');panel.appendChild(results);anchor.insertAdjacentElement('beforebegin',panel);
 var busy=false,buttons=[],data;
 var mode=document.createElement('select');mode.setAttribute('aria-label','Parcours de simulation');[['reference','Référence gratuite'],['ai','Agents IA (appels au fournisseur)']].forEach(x=>{var o=el('option',x[1]);o.value=x[0];mode.appendChild(o);});controls.appendChild(mode);var budget=document.createElement('input');budget.type='number';budget.min='1';budget.max='1000';budget.value='24';budget.setAttribute('aria-label','Plafond total des appels IA de la campagne');controls.appendChild(budget);mode.onchange=()=>load().catch(e=>status.textContent=e.message);
 function button(label,fn){var b=el('button',label);b.type='button';b.className='btn ghost';b.onclick=fn;controls.appendChild(b);buttons.push(b);return b;}
 async function load(){var r=await OM.api('/api/app?route=shadow&firm=1&mode='+mode.value);data=r.campaign;render();}
 async function act(action,extra){if(busy)return;busy=true;mode.disabled=true;buttons.forEach(b=>b.disabled=true);status.textContent='Exécution…';try{await OM.api('/api/app?route=shadow',{method:'POST',body:JSON.stringify(Object.assign({action:action,mode:mode.value},extra||{}))});await load();return true;}catch(e){status.textContent='Action interrompue : '+e.message+' — la progression déjà enregistrée est conservée.';return false;}finally{busy=false;mode.disabled=false;buttons.forEach(b=>b.disabled=false);}}
 var reportLink=el('a','Voir les résultats de référence déjà calculés');reportLink.href='/cabinet-simulation-resultats.html';panel.appendChild(reportLink);
 var create=button('Créer le cabinet',()=>act('firm-create',{seed:1,max_calls:Number(budget.value)}));
 button('Démarrer / reprendre',()=>act('firm-start'));
 button('Pause',()=>act('firm-pause'));
 button('Référence : avancer de 100 événements',()=>act('firm-reference',{limit:100}));
 button('IA : exécuter une étape',()=>act('firm-ai-step'));
 button('IA : exécuter jusqu’à 10 étapes',async()=>{for(var i=0;i<10;i++){var ok=await act('firm-ai-step');if(!ok)break;if(!data||data.status!=='running'||data.last_error)break;}});
 button('Corriger une tentative bloquée',()=>{var note=window.prompt('Correction à transmettre à l’agent (simulation uniquement) :');if(note)act('firm-correct',{note:note});});
 button('Actualiser',()=>load().catch(e=>status.textContent=e.message));
 button('Télécharger les résultats',()=>{if(!data)return;var u=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));var a=el('a');a.href=u;a.download='cabinet-15-resultats.json';a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);});
 function render(){results.textContent='';create.hidden=!!data;if(!data){status.textContent='Aucune campagne. Créez le cabinet pour commencer.';return;}
 status.textContent=data.virtual_date+' · '+data.status+' · '+data.summary.months_elapsed+'/24 mois · '+data.summary.proposals+' productions simulées · '+data.budget.calls+'/'+data.budget.max_calls+' appels IA réservés/consommés';
 if(data.blocker)results.appendChild(el('p','Blocage : '+data.blocker));if(data.last_error)results.appendChild(el('p','Dernière erreur : '+data.last_error));
 results.appendChild(el('p','Référence : '+data.results.reference_events+' événements. IA : '+data.results.ai_events+' événements. Score structurel IA : '+(data.evaluation.structural_ai_score==null?'non mesuré':data.evaluation.structural_ai_score+' %')+'. Qualité de jugement : non évaluée.'));
 results.appendChild(el('p','Missions clôturées en simulation : '+data.summary.closed+' ; refusées : '+data.summary.refused+' ; propositions perdues : '+data.summary.lost+'.'));
 if(data.next_event)results.appendChild(el('p','Prochaine étape : '+data.next_event.mission_id+' — '+data.next_event.title+' ('+data.next_event.agent+').'));
 var team=el('details');team.appendChild(el('summary','Les 15 collaborateurs fictifs'));data.staff.forEach(x=>team.appendChild(el('p',x.name+' · '+x.role)));results.appendChild(team);
 var table=el('table'),head=el('tr');['Mission','Étape','État','Productions'].forEach(x=>head.appendChild(el('th',x)));table.appendChild(head);
 data.missions.forEach(m=>{var r=el('tr');[m.name,String(m.stage)+'/13',m.outcome||m.state,String(m.artifacts.length)].forEach(x=>r.appendChild(el('td',x)));table.appendChild(r);});results.appendChild(table);
 var logs=el('details');logs.appendChild(el('summary','Derniers résultats et échanges fictifs'));data.events.slice(-20).reverse().forEach(x=>{var a=el('article');a.appendChild(el('h3',x.mission_id+' — '+x.stage+' · '+x.mode));a.appendChild(el('p',x.summary));a.appendChild(el('p',x.feedback));(x.messages||[]).forEach(m=>a.appendChild(el('p',m.to+' : '+m.text)));(x.human_replies||[]).forEach(m=>a.appendChild(el('p',m.from+' (personnage simulé) : '+m.text)));logs.appendChild(a);});results.appendChild(logs);
 var lessons=el('details');lessons.appendChild(el('summary','Leçons proposées, non appliquées à la production'));data.lessons.forEach(l=>lessons.appendChild(el('p',l.id+' : '+l.text)));results.appendChild(lessons);
 }
 load().catch(e=>status.textContent='Chargement impossible : '+e.message);
})();

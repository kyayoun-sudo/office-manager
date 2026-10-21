(function(){
  'use strict';
  var OM=window.OfficeManager;
  function el(tag,text){var n=document.createElement(tag);if(text!=null)n.textContent=text;return n;}
  var errors={CORRECTION_VALUES_REQUIRED:'Modifiez une valeur du compte rendu avant d’appliquer une correction.',CORRECTION_CELL_NOT_OWNED:'Cette cellule ne fait pas partie du remplissage enregistré.',MEMORY_CONFLICT:'Le travail a changé dans un autre onglet. Actualisez avant de confirmer.',HUMAN_CONFIRMATION_REQUIRED:'Confirmez ou corrigez d’abord le remplissage précédent.',WORK_CHANGED_PREPARE_AGAIN:'Le fichier a changé depuis ce compte rendu. La confirmation est bloquée : actualisez et vérifiez les cellules.',CORRECTION_NOTE_REQUIRED:'Précisez ce qui est à corriger.',SOP_CHANGED_PREPARE_AGAIN:'Le SOP ou la période a changé : ce travail doit être réexaminé.'};
  OM.renderWorkpaperDialogue=function(host,records,post){
    records.forEach(function(r){
      var box=el('section');box.className='note';box.setAttribute('aria-label','Remplissage de l’étape '+r.step);
      box.appendChild(el('h3','Étape '+r.step+' — ce que j’ai rempli'));
      box.appendChild(el('p',r.receipt.model_cells+' cellule(s) du modèle renseignée(s) ; '+r.receipt.source_facts+' fait(s) dans la feuille « '+r.sheet+' ».'));
      if(r.receipt.import_rows)box.appendChild(el('p',r.receipt.import_rows+' lignes client importées. Les données brutes restent conservées sans correction manuelle dans ce compte rendu.'));
      if(r.coverage&&!r.coverage.exhaustive)box.appendChild(el('p','Lecture documentaire incomplète. Confirmer ces saisies ne signifie pas que toutes les pièces ont été lues.'));
      var state=r.confirmation?.status||'awaiting_confirmation';
      box.appendChild(el('p',!r.current?'Fichier, SOP ou période modifié : à réexaminer':state==='confirmed'?'Confirmé ensemble par '+r.confirmation.by:state==='correction_requested'?'Correction demandée : '+r.confirmation.note:'Rempli — à confirmer avec vous'));
      var list=el('div'),inputs=[],offset=0;box.appendChild(list);
      function rows(cells){cells.forEach(function(c){
        var row=el('div'),label=el('label',c.sheet+'!'+c.cell+' — valeur enregistrée');
        var field=el('textarea');field.value=String(c.value??'');field.setAttribute('aria-label','Corriger '+c.sheet+'!'+c.cell);field.disabled=!r.current||r.editable===false||state==='confirmed'||c.source_value;label.appendChild(field);row.appendChild(label);
        inputs.push({field:field,cell:c});
        if(c.raw_value!=null&&c.raw_value!==c.value)row.appendChild(el('p','Valeur dans la source : '+c.raw_value));
        if(c.source)row.appendChild(el('p','Source : '+c.source+' · '+(c.reference||'')));
        if(c.quote)row.appendChild(el('blockquote',c.quote));
        if(c.file_id){var link=el('a','Ouvrir la pièce');link.href='https://drive.google.com/file/d/'+encodeURIComponent(c.file_id)+'/view';link.target='_blank';link.rel='noopener';row.appendChild(link);}
        list.appendChild(row);
      });offset+=cells.length;}
      rows(r.receipt.cells);
      var more=el('button','Afficher les cellules suivantes');more.type='button';more.className='btn ghost';more.hidden=offset>=r.receipt.cells_total;
      more.onclick=async function(){more.disabled=true;try{var page=await post({action:'reading-report',plan_id:r.plan_id,offset:offset});rows(page.receipt.cells);more.hidden=offset>=page.receipt.cells_total;}catch(e){say.textContent=e.message;}more.disabled=false;};box.appendChild(more);
      var note=el('textarea');note.setAttribute('aria-label','Votre retour pour l’étape '+r.step);note.placeholder='Votre précision ou la correction demandée';box.appendChild(note);
      var say=el('p');say.setAttribute('role','status');
      var buttons=[];
      function button(text,decision){var b=el('button',text);b.type='button';b.className='btn ghost';b.disabled=!r.current||r.editable===false;buttons.push(b);b.onclick=async function(){buttons.forEach(function(x){x.disabled=true;});say.textContent='Vérification des cellules enregistrées…';try{
        var edits=inputs.filter(function(x){return x.field.value!==String(x.cell.value??'');}).map(function(x){return {sheet:x.cell.sheet,cell:x.cell.cell,value:x.field.value};});
        if(decision==='confirm'&&edits.length)throw new Error('Appliquez vos corrections avant de confirmer.');
        await post({action:'review-workpaper',plan_id:r.plan_id,decision:decision,note:note.value,edits:edits});
        window.dispatchEvent(new Event('workpaper-dialogue-updated'));
      }catch(e){say.textContent=errors[e.message]||e.message;buttons.forEach(function(x){x.disabled=false;});}};box.appendChild(b);}
      if(state!=='confirmed'){button('Je confirme ce remplissage','confirm');button('Appliquer mes corrections dans Excel','apply-correction');button('Demander une correction à l’agent','request-correction');}
      box.appendChild(el('small','Cette confirmation porte sur les saisies. Elle ne conclut ni ne signe le test d’audit.'));box.appendChild(say);host.appendChild(box);
    });
  };
})();

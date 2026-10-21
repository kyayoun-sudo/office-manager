document.getElementById('check-providers').onclick=async function(){
  const button=this,list=document.getElementById('diagnostic-results'),status=document.getElementById('diagnostic-status');button.disabled=true;list.textContent='';
  try{const configured=await window.OfficeManager.api('/api/app?route=ai-providers');
    for(const provider of ['mistral','huggingface','groq','eynowa-lab']){
      const item=document.createElement('li');list.appendChild(item);
      if(!configured[provider]){item.textContent=provider+' : non configuré dans ce déploiement';continue;}
      status.textContent='Vérification de '+provider+'…';
      try{const r=await window.OfficeManager.api('/api/app?route=ai-providers',{method:'POST',body:JSON.stringify({provider})});item.textContent=provider+' : '+(r.ok?'réponse réelle reçue — '+r.model:r.error);}catch(e){item.textContent=provider+' : '+e.message;}
    }status.textContent='Vérification terminée. Ce test confirme une connexion, pas la qualité d’un travail d’audit.';
  }catch(e){status.textContent=e.message;}finally{button.disabled=false;}
};

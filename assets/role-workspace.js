(function () {
  'use strict';
  var agents = {
    auto: ['FM', 'Firm Manager', 'Cabinet, équipe et opportunités'],
    'mission-controller': ['MC', 'Mission Controller', 'Organisation et suivi de mission'],
    'enhanced-auditor': ['EA', 'Enhanced Auditor', 'Assistance technique à l’audit'],
    orpailleur: ['OR', 'Orpailleur', 'Documents, références et classement'],
    sika: ['SI', 'SIKA', 'Facturation et recouvrement']
  };
  var profiles = {
    owner: { label: 'Owner', title: 'Le cabinet', lead: 'Vos décisions, vos missions et les ressources du cabinet, réunies dans un espace de pilotage.', focus: 'Les priorités du cabinet', agents: ['auto','mission-controller','enhanced-auditor','orpailleur','sika'], actions: [['/pilotage.html','Piloter le cabinet','Portefeuille, risques et décisions'],['/opportunites.html','Examiner les opportunités','AMI, TDR et équipe proposée'],['/equipe.html','Organiser les ressources','Équipe, capacité et responsabilités'],['/parametres.html','Configurer le cabinet','Identité, comptes et documents']] },
    partner: { label: 'Partner', title: 'Mes décisions et mes dossiers', lead: 'Les décisions qui vous reviennent, les offres à revoir et les missions à superviser.', focus: 'Décisions et revues attendues', agents: ['auto','mission-controller','enhanced-auditor','orpailleur','sika'], actions: [['/opportunites.html','Décider sur un AMI','Poursuite, équipe et points ouverts'],['/validations.html','Examiner mes validations','Propositions et décisions attendues'],['/pilotage.html','Superviser les missions','Risques et jugements importants'],['/assistant.html?agent=auto','Consulter Firm Manager','Préparer un arbitrage']] },
    manager: { label: 'Manager', title: 'Mes missions à piloter', lead: 'Organisez votre équipe, suivez les échéances et retrouvez les travaux à revoir.', focus: 'Mes prochaines actions', agents: ['mission-controller','auto','enhanced-auditor','orpailleur','sika'], actions: [['/mission.html','Piloter mes missions','Équipe, planning et points ouverts'],['/preparation.html','Préparer une mission','Exigences, compétences et documents'],['/validations.html','Revoir les propositions','Les décisions de votre périmètre'],['/equipe.html','Suivre mon équipe','Personnes et charge autorisées']] },
    senior: { label: 'Senior', title: 'Mes travaux et mes revues', lead: 'Vos cycles, les travaux soumis à votre revue et les corrections à suivre.', focus: 'Travaux à revoir et à préparer', agents: ['enhanced-auditor','mission-controller','orpailleur'], actions: [['/mission.html','Ouvrir mes cycles','Travaux et échéances de mission'],['/auditeur.html','Travailler avec Enhanced Auditor','Assistance technique et revue'],['/validations.html','Retrouver mes demandes','Questions et confirmations'],['/rangement.html','Retrouver mes documents','Pièces et fichiers utiles']] },
    auditor: { label: 'Auditeur', title: 'Mon travail aujourd’hui', lead: 'Retrouvez votre travail, vos pièces et les retours de votre relecteur. Votre agent vous accompagne dans votre métier.', focus: 'Ce qui m’est demandé', agents: ['enhanced-auditor','orpailleur','mission-controller'], actions: [['/mission.html','Continuer mon travail','Mes missions, cycles et procédures'],['/assistant.html?agent=enhanced-auditor','Travailler avec mon agent','Préparer mon travail d’audit'],['/rangement.html','Ouvrir mes documents','Les pièces utiles à mon travail'],['/equipe.html','Voir mon suivi','Mes informations et indicateurs']] },
    secretary: { label: 'Secrétariat', title: 'Les dossiers à préparer et à envoyer', lead: 'Réception des AMI, pièces à réunir, documents à finaliser et envois autorisés.', focus: 'Dossiers et demandes à traiter', agents: ['orpailleur','mission-controller','auto'], actions: [['/opportunites.html','Déposer un AMI / TDR','Réception et informations du dossier'],['/secretariat.html','Préparer les documents','Modèles, annexes et envois'],['/rangement.html','Réunir les pièces','CV, références et documents'],['/messagerie.html','Retrouver les échanges','Demandes et réponses du cabinet']] },
    finance: { label: 'Finance', title: 'Honoraires, dépenses et encaissements', lead: 'Les fichiers de quotation, les justificatifs et le suivi financier de votre périmètre.', focus: 'Contrôles financiers à traiter', agents: ['sika','mission-controller','orpailleur'], actions: [['/assistant.html?agent=sika','Travailler avec SIKA','Factures, suivi et recouvrement'],['/secretariat.html','Ouvrir les modèles','Fichier de quotation du cabinet'],['/validations.html','Examiner les demandes','Contrôles et pièces à vérifier'],['/rangement.html','Retrouver les justificatifs','Documents financiers autorisés']] },
    external: { label: 'Spécialiste externe', title: 'Ma contribution à la mission', lead: 'Votre demande, les documents partagés et les livrables attendus dans le périmètre de votre intervention.', focus: 'Ma contribution attendue', agents: [], actions: [['#contribution','Lire ma demande','Périmètre et échéance'],['#documents','Documents partagés','Seulement les pièces autorisées'],['#messages','Poser une question','Mon interlocuteur de mission'],['#livrables','Déposer mon livrable','Remise et retour du cabinet']] },
    bdm: { label: 'Business Development', title: 'Mes opportunités et mes offres', lead: 'Les appels d’offres retenus, les TDR à obtenir et les candidatures à préparer.', focus: 'Mes opportunités à suivre', agents: ['auto','mission-controller','orpailleur'], actions: [['/veille.html','Suivre les appels d’offres','Avis et décisions des associés'],['/opportunites.html','Préparer mes candidatures','TDR, équipe et dossier'],['/secretariat.html','Finaliser les documents','Modèles et annexes'],['/messagerie.html','Coordonner les échanges','Interlocuteurs et contributions']] },
    it_admin: { label: 'Administration informatique', title: 'Comptes et connexions', lead: 'Les comptes, les accès et les connexions du cabinet.', focus: 'État de configuration', agents: [], actions: [['/parametres.html','Gérer les comptes','Rôles et accès'],['/mise-en-service.html','Vérifier la configuration','Connexions et disponibilité']] }
  };
  profiles.supervisor = Object.assign({}, profiles.manager, {label:'Superviseur',title:'Mes missions à superviser'});
  profiles.collaborator = profiles.auditor;
  profiles.quality_reviewer = Object.assign({}, profiles.senior, {label:'Revue qualité',title:'Mes revues qualité',lead:'Les dossiers et jugements qui attendent votre revue qualité.'});
  function el(tag, text, cls) { var n = document.createElement(tag); if (text != null) n.textContent = text; if (cls) n.className = cls; return n; }
  function renderHeader(host, profile, name) {
    var hero = el('header', null, 'workspace-hero'), text = el('div');
    text.appendChild(el('div', profile.label + ' · Mon espace', 'workspace-eyebrow'));
    text.appendChild(el('h1', profile.title)); text.appendChild(el('p', profile.lead)); hero.appendChild(text);
    hero.appendChild(el('div', (name || profile.label).split(/\s+/).map(function(w){return w[0];}).slice(0,2).join('').toUpperCase(), 'workspace-avatar')); host.appendChild(hero);
    var launchers = el('div', null, 'workspace-launchers');
    profile.actions.forEach(function(a){var link=el('a',null,'workspace-launcher');link.href=a[0];link.appendChild(el('strong',a[1]));link.appendChild(el('span',a[2]));link.appendChild(el('i','→'));launchers.appendChild(link);});host.appendChild(launchers);
    var agentDetails=el('details',null,'workspace-agent-details');agentDetails.appendChild(el('summary','Mes agents')); var strip=el('div',null,'workspace-agents');
    profile.agents.forEach(function(key){var a=agents[key],link=el('a',null,'workspace-agent');link.href='/assistant.html?agent='+encodeURIComponent(key);link.appendChild(el('b',a[0]));var info=el('span',a[1]);info.appendChild(el('small',a[2]));link.appendChild(info);strip.appendChild(link);});
    if (!profile.agents.length) strip.appendChild(el('p','Assistant de contribution — accès limité à la mission','workspace-detail'));
    agentDetails.appendChild(strip);host.appendChild(agentDetails);
  }
  function home() {
    var OM=window.OfficeManager; if(!OM || !document.getElementById('myspace'))return;
    var role=OM.getRole(), p=profiles[role] || profiles.auditor, main=document.querySelector('.main');
    var head=document.querySelector('.page-head'); if(head)head.hidden=true;
    var intro=el('div'); intro.id='role-workspace'; renderHeader(intro,p,OM.getUserName());
    var anchor=document.getElementById('myspace');main.insertBefore(intro,anchor);
    anchor.classList.add('workspace-alerts');document.getElementById('h-myspace').textContent=p.focus;
    document.getElementById('myspace-lead').hidden=true;document.getElementById('myspace-links').hidden=true;
    var columns=el('div',null,'workspace-grid'),left=el('div',null,'workspace-column'),right=el('aside',null,'workspace-column');columns.appendChild(left);columns.appendChild(right);main.insertBefore(columns,anchor);
    var leftIds=role==='owner'?['myspace','mysteps','cockpit-section','missions-card','myprocs','myreviews']:['myspace','mysteps','myreviews','myprocs','mywork','missions-card'];
    var rightIds=role==='owner'?['pending-card','runs-card','passes-card','mails','shortcuts']:['pending-card','workspace-updates','shortcuts','mails'];
    leftIds.forEach(function(id){var n=document.getElementById(id);if(n)left.appendChild(n);});
    rightIds.forEach(function(id){var n=document.getElementById(id);if(n)right.appendChild(n);});
    if(role!=='owner'){
      ['cockpit-section','runs-card','passes-card'].forEach(function(id){var n=document.getElementById(id);if(n)n.hidden=true;});
      var updates=el('section',null,'card workspace-alerts');updates.appendChild(el('h2','Messages et documents','workspace-heading'));var list=el('div');updates.appendChild(list);right.insertBefore(updates,right.firstChild);
      document.getElementById('myspace-items').hidden=true;var priorities=el('div',null,'stack');anchor.appendChild(priorities);priorities.appendChild(el('p','Chargement…','empty'));
      list.appendChild(el('p','Chargement des demandes qui vous concernent…','empty'));
      OM.api('/api/app?route=notifications').then(function(d){
        list.textContent='';priorities.textContent='';
        function fill(target,notices,empty){if(!notices.length)target.appendChild(el('p',empty,'empty'));notices.slice(0,6).forEach(function(n){var a=el('a',null,'item link-item');a.href=n.href||'/validations.html';var info=el('div',null,'t');info.appendChild(el('span',n.title));if(n.meta)info.appendChild(el('span',n.meta,'meta'));a.appendChild(info);a.appendChild(el('span',n.label,'tag'));target.appendChild(a);});}
        fill(priorities,(d.notifications||[]).filter(function(n){return n.action_required;}),'Aucune nouvelle demande à traiter pour le moment.');
        fill(list,(d.notifications||[]).filter(function(n){return !n.action_required;}),'Aucun nouveau message ou document pour le moment.');
      }).catch(function(){[list,priorities].forEach(function(target){target.textContent='';target.appendChild(el('p','Les demandes sont momentanément indisponibles. Consultez vos notifications.','empty'));});});
    }
    if(role==='secretary')document.getElementById('h-mywork').textContent='Mes dossiers et mes tâches';
    if(role==='senior')document.getElementById('h-myreviews').textContent='Les travaux soumis à ma revue';
    if(role==='auditor'||role==='collaborator')document.getElementById('h-mywork').textContent='Mes travaux à réaliser';
    var learning = el('section', null, 'card'); learning.id = 'personal-learning';
    learning.appendChild(el('h2', 'Mon apprentissage et mes agents'));
    learning.appendChild(el('p', 'Trois parcours distincts, adaptés à votre rôle : questions métier, consignes pour votre agent et cas pratiques de collaboration. Vos exercices ne modifient jamais une mission réelle.', 'workspace-detail'));
    var choices = el('div', null, 'workspace-tabs');
    [['M’améliorer · trois questions métier', '/apprentissage.html?mode=monthly'], ['Entraîner mon IA', '/apprentissage.html?mode=agent'], ['Mieux travailler avec mon agent', '/apprentissage.html?mode=collaboration']].forEach(function (x) { var a = el('a', x[0], 'btn ghost'); a.href = x[1]; choices.appendChild(a); });
    if (['owner', 'partner', 'it_admin'].indexOf(role) >= 0) { var lab = el('a', 'Simulations et entraînement du cabinet', 'btn ghost'); lab.href = '/entrainement.html'; choices.appendChild(lab); }
    learning.appendChild(choices); main.appendChild(learning);
    var dossierLink=el('a','Mes dossiers : travaux, pièces et prochaines actions →','workspace-preview-link');dossierLink.href='/dossiers.html';intro.appendChild(dossierLink);
    var link=el('a','Voir la présentation des huit métiers →','workspace-preview-link');link.href='/presentation.html';intro.appendChild(link);
  }
  function assistant(){
    var OM=window.OfficeManager,box=document.getElementById('agents');if(!OM||!box)return;
    var p=profiles[OM.getRole()]||profiles.auditor;
    box.querySelectorAll('[data-agent]').forEach(function(b){var key=b.getAttribute('data-agent');b.hidden=key!=='auto'&&p.agents.indexOf(key)<0;});
    var lead=document.querySelector('.page-head .lead');if(lead)lead.textContent='Vos agents pour '+p.label.toLowerCase()+' : posez une question ou demandez de l’aide sur votre travail. Les accès et validations du cabinet restent applicables.';
    var input=document.getElementById('message');if(input)input.placeholder=OM.getRole()==='auditor'?'Aide-moi à préparer mon travail sur ce cycle et à préciser les preuves nécessaires.':'Aide-moi à organiser le travail de mon dossier et à identifier la prochaine action.';
    var requested=new URLSearchParams(location.search).get('agent');var selected=box.querySelector('[data-agent="'+(p.agents.indexOf(requested)>=0?requested:'auto')+'"]');if(selected)selected.click();
    var advanced=document.getElementById('provider');if(advanced){var wrap=advanced.closest('.two');if(wrap){var details=el('details');details.appendChild(el('summary','Options de réponse'));wrap.parentNode.insertBefore(details,wrap);details.appendChild(wrap);}}
  }
  function simplifyNav(){
    var OM=window.OfficeManager;if(!OM||OM.getRole()==='owner')return;var nav=document.querySelector('.nav');if(!nav)return;
    var keep=['/accueil.html','/dossiers.html','/assistant.html','/messagerie.html','/validations.html','/rangement.html','/equipe.html','/entrainement.html','/mission.html'];
    var details=el('details',null,'workspace-secondary-nav');details.appendChild(el('summary','Autres espaces'));var who=nav.querySelector('.who');nav.insertBefore(details,who||null);
    Array.from(nav.children).forEach(function(a){if(a.tagName==='A'&&keep.indexOf(a.getAttribute('href'))<0&&a.getAttribute('aria-current')!=='page')details.appendChild(a);});
  }
  window.FirmWorkspace={profiles:profiles,agents:agents,renderHeader:renderHeader};
  function ready(){if(document.body.classList.contains('workspace-demo'))return;home();assistant();simplifyNav();}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',ready);else ready();
})();

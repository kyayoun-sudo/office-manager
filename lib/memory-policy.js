export const CUSTOMER_OWNED_CONTENT = Object.freeze([
  'working_papers','audit_evidence','pbc_documents','risk_assessment_documents',
  'work_programme_documents','engagement_letters','kyc_detailed_files',
  'independence_detailed_responses','emails_and_attachments','cv_full_documents','issued_reports'
]);

export const CONTROL_PLANE_FIELDS = Object.freeze([
  'tenant_id','engagement_id','object_id','provider_file_id','provider_url',
  'status','stage','version','hash','relationship_ids','assigned_user_ids',
  'deadline','next_action','event_refs','signoff_refs','short_explanation'
]);

export const DO_NOT_DUPLICATE_BY_DEFAULT = Object.freeze([
  'home_address','date_of_birth','health_data','family_status','government_identifiers',
  'personal_bank_details','full_cv','detailed_independence_answers','full_mailbox_content'
]);

export function compactDocumentReference({
  provider,fileId,url=null,version=null,hash=null,modifiedAt=null,
  engagementId=null,documentType=null
}) {
  if (!provider || !fileId) throw new Error('PROVIDER_AND_FILE_ID_REQUIRED');
  return Object.freeze({
    provider,file_id:String(fileId),web_url:url,version,hash,modified_at:modifiedAt,
    engagement_id:engagementId,document_type:documentType
  });
}

export function buildAiContext({
  engagement,task,documentRefs=[],riskRefs=[],pbcRefs=[],maxDocuments=12
}) {
  if (!task) throw new Error('AI_TASK_REQUIRED');
  return {
    engagement:engagement ? {
      id:engagement.id,stage:engagement.stage,period:engagement.period,role:engagement.role
    } : null,
    task:String(task).slice(0,1000),
    document_refs:documentRefs.slice(0,maxDocuments),
    risk_refs:riskRefs.slice(0,30),
    pbc_refs:pbcRefs.slice(0,50),
    policy:{
      fetch_full_content_only_when_needed:true,
      do_not_expand_unrelated_engagements:true,
      no_cross_tenant_context:true
    }
  };
}

export type AuditEvent={type:"checkout.created"|"checkout.replayed"; checkoutId:string; orderId:string; requestId:string; at:string};
export class AuditLog{private readonly events:AuditEvent[]=[]; append(event:AuditEvent){this.events.push(Object.freeze({...event}))}; all(){return [...this.events]}}

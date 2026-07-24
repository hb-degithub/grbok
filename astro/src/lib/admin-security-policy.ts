import { getPocketBase } from './pocketbase';
import { withAuthRequestHeaders } from './security';
export interface RateValue { limit: number; windowSeconds: number }
export interface RateBound { minLimit: number; maxLimit: number; minWindow: number; maxWindow: number }
export interface PolicyDto { version: number; policies: Record<string, RateValue>; bounds: Record<string, RateBound> }
export async function getSecurityPolicies() { const pb = getPocketBase(); return withAuthRequestHeaders(pb, () => pb.send<PolicyDto>('/api/blog-admin/security/rate-policy', { method: 'GET' })); }
export async function putSecurityPolicies(value: PolicyDto) { const pb = getPocketBase(); return withAuthRequestHeaders(pb, () => pb.send<PolicyDto>('/api/blog-admin/security/rate-policy', { method: 'PUT', body: { version: value.version, policies: value.policies } })); }
export async function getRegistrationMode() { const pb = getPocketBase(); return withAuthRequestHeaders(pb, () => pb.send<{mode:'open'|'invite_only';version:number}>('/api/blog-admin/security/registration-mode', { method: 'GET' })); }
export async function putRegistrationMode(mode: 'open'|'invite_only', version: number) { const pb = getPocketBase(); return withAuthRequestHeaders(pb, () => pb.send<{mode:'open'|'invite_only';version:number}>('/api/blog-admin/security/registration-mode', { method: 'PUT', body: { mode, version } })); }

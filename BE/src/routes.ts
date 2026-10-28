import type { Router } from 'express';
import { authRouter } from './features/auth/auth.routes';
import { bootstrapRouter } from './features/bootstrap/bootstrap.routes';
import { facilitiesRouter, unitsRouter } from './features/facilities/facilities.routes';
import { reservationsRouter } from './features/reservations/reservations.routes';
import { contractsRouter, inspectionsRouter } from './features/contracts/contracts.routes';
import { paymentsRouter } from './features/payments/payments.routes';
import { ticketsRouter } from './features/tickets/tickets.routes';
import { claimsRouter } from './features/claims/claims.routes';
import { swapsRouter } from './features/swaps/swaps.routes';
import { servicesRouter } from './features/services/services.routes';
import { accessRouter } from './features/access/access.routes';
import { policiesRouter } from './features/policies/policies.routes';
import { contractTemplatesRouter } from './features/contract-templates/contract-templates.routes';
import { usersRouter } from './features/users/users.routes';
import { auditRouter } from './features/audit/audit.routes';
import { reportsRouter } from './features/reports/reports.routes';
import { privacyRouter } from './features/privacy/privacy.routes';
import { intakeRouter } from './features/intake/intake.routes';

/**
 * Bảng gắn router duy nhất. app.ts mount từ đây, openapi.ts đi qua đây để sinh spec
 * → thêm router mới ở đây là Swagger có ngay, không phải khai báo lần hai.
 */
export interface Mount { prefix: string; router: Router }

export const API_MOUNTS: Mount[] = [
  { prefix: '/auth', router: authRouter },
  { prefix: '/bootstrap', router: bootstrapRouter },
  { prefix: '/facilities', router: facilitiesRouter },
  { prefix: '/units', router: unitsRouter },
  { prefix: '/reservations', router: reservationsRouter },
  { prefix: '/contracts', router: contractsRouter },
  { prefix: '/inspections', router: inspectionsRouter },
  { prefix: '/payments', router: paymentsRouter },
  { prefix: '/tickets', router: ticketsRouter },
  { prefix: '/claims', router: claimsRouter },
  { prefix: '/swap-requests', router: swapsRouter },
  { prefix: '/services', router: servicesRouter },
  { prefix: '/access-requests', router: accessRouter },
  { prefix: '/intake-batches', router: intakeRouter },
  { prefix: '/policies', router: policiesRouter },
  { prefix: '/contract-templates', router: contractTemplatesRouter },
  { prefix: '/privacy-requests', router: privacyRouter },
  { prefix: '/users', router: usersRouter },
  { prefix: '/audit', router: auditRouter },
  { prefix: '/reports', router: reportsRouter },
];

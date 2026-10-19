import { Router } from 'express';
import { z } from 'zod';
import { enumValues, Role, UnitCategory, withPolicyDefaults } from '@ssm/shared';
import { PolicyModel } from '../../shared/db/models';
import { authenticate } from '../../shared/http/authenticate';
import { authorize } from '../../shared/http/authorize';
import { assertFacility } from '../../shared/http/scope';
import { idParams, validate, zId, zMoney } from '../../shared/http/validate';
import { effectivePolicy } from './pricing';
import { publishPolicy } from './policy.service';

const e = <T extends string>(o: Record<string, T>) => z.enum(enumValues(o) as [T, ...T[]]);

// ---------------------------------------------------------------- policies (OPS_MANAGER)
export const policiesRouter = Router();
policiesRouter.use(authenticate);

policiesRouter.get('/effective/:id', validate({ params: idParams }), async (req, res) => {
  res.json(withPolicyDefaults((await effectivePolicy(req.valid.params.id)).toJSON()));
});
policiesRouter.get('/', authorize('OPS_MANAGER', 'ADMIN', 'FACILITY_MANAGER'), validate({ query: z.object({ facilityId: zId.optional() }) }), async (req, res) => {
  const fid = req.valid.query.facilityId;
  if (fid) await assertFacility(req.auth!.user, fid);
  const items = await PolicyModel.find(fid ? { scope: 'FACILITY', facilityId: fid } : { scope: 'GLOBAL' }).sort({ version: -1 });
  res.json({ items: items.map((p) => withPolicyDefaults(p.toJSON())) });
});

const tier = z.object({ minHoursBeforeStart: z.number().min(0), depositRefundPct: z.number().min(0).max(100) });
const earlyTerminationTier = z.object({ maxElapsedPct: z.number().min(0).max(100), depositRefundPct: z.number().min(0).max(100) });
policiesRouter.post('/', authorize('OPS_MANAGER'), validate({ body: z.object({
  facilityId: zId.nullable().default(null),
  patch: z.object({
    gracePeriodDays: z.number().int().min(0).max(60), lockoutAfterDays: z.number().int().min(1).max(180),
    abandonAfterLockedOutDays: z.number().int().min(1).max(365),
    accessFees: z.object({ PIN_RESET: zMoney, CARD_REISSUE: zMoney, KEY_REISSUE: zMoney }),
    reservationHoldMinutes: z.number().int().min(5).max(1440), allocationLeadDays: z.number().int().min(0).max(60), noShowAfterHours: z.number().int().min(1).max(168),
    minPeriods: z.number().int().min(1), maxPeriods: z.number().int().max(365),
    deposit: z.object({ mode: z.enum(['PERIODS_OF_RENT', 'FIXED']), value: z.number().min(0) }),
    lateFees: z.array(z.object({ afterDays: z.number().min(0), kind: z.enum(['FIXED', 'PERCENT_OF_RENT']), value: z.number().min(0), recurringEveryDays: z.number().int().min(1).nullable().default(null) })).max(10),
    cancellation: z.array(tier).max(10),
    earlyTermination: z.array(earlyTerminationTier).max(10),
    // Phụ phí add-on (VD CLIMATE = điều hòa) — chính sách riêng từng chi nhánh nên giá add-on cũng riêng từng chi nhánh.
    surcharges: z.array(z.object({
      code: z.string().min(1).max(30), label: z.string().min(1).max(100), kind: z.enum(['FIXED', 'PERCENT']),
      value: z.number().min(0), categories: z.array(e(UnitCategory)),
    })).max(10),
    discounts: z.array(z.object({ code: z.string(), kind: z.enum(['FIXED', 'PERCENT']), value: z.number().min(0), minPeriods: z.number().int().min(1), validFrom: z.coerce.date().nullable().default(null), validTo: z.coerce.date().nullable().default(null), requiresApprovalRole: e(Role).nullable().default(null) })).max(20),
  }).partial().strict(),
}) }), async (req, res) => {
  res.status(201).json(await publishPolicy(req.valid.body.facilityId, req.valid.body.patch));
});

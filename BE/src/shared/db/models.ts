export * from '../../features/users/user.model';
export * from '../../features/facilities/facility.model';
export * from '../../features/facilities/unit-type.model';
export * from '../../features/facilities/storage-unit.model';
export * from '../../features/reservations/reservation.model';
export * from '../../features/contracts/rental-contract.model';
export * from '../../features/payments/payment-transaction.model';
export * from '../../features/payments/gateway-order.model';
export * from '../../features/contracts/inspection-log.model';
export * from '../../features/tickets/support-ticket.model';
export * from '../../features/claims/damage-claim.model';
export * from '../../features/policies/business-policy.model';
export * from '../../features/audit/audit-log.model';
export * from '../../features/swaps/unit-swap-request.model';
export * from '../../features/services/service-offering.model';
export * from '../../features/services/service-order.model';
export * from '../../features/access/access-request.model';
export * from '../../features/contract-templates/contract-template.model';
export * from '../../features/privacy/privacy-request.model';
export * from '../../features/reservations/email-verification.model';
export * from '../../features/intake/intake-batch.model';

import { UserModel } from '../../features/users/user.model';
import { FacilityModel } from '../../features/facilities/facility.model';
import { UnitTypeModel } from '../../features/facilities/unit-type.model';
import { StorageUnitModel } from '../../features/facilities/storage-unit.model';
import { ReservationModel } from '../../features/reservations/reservation.model';
import { RentalContractModel } from '../../features/contracts/rental-contract.model';
import { PaymentModel } from '../../features/payments/payment-transaction.model';
import { GatewayOrderModel } from '../../features/payments/gateway-order.model';
import { InspectionModel } from '../../features/contracts/inspection-log.model';
import { TicketModel } from '../../features/tickets/support-ticket.model';
import { DamageClaimModel } from '../../features/claims/damage-claim.model';
import { PolicyModel } from '../../features/policies/business-policy.model';
import { AuditLogModel } from '../../features/audit/audit-log.model';
import { UnitSwapRequestModel } from '../../features/swaps/unit-swap-request.model';
import { ServiceOfferingModel } from '../../features/services/service-offering.model';
import { ServiceOrderModel } from '../../features/services/service-order.model';
import { AccessRequestModel } from '../../features/access/access-request.model';
import { ContractTemplateModel } from '../../features/contract-templates/contract-template.model';
import { PrivacyRequestModel } from '../../features/privacy/privacy-request.model';
import { EmailVerificationModel } from '../../features/reservations/email-verification.model';
import { IntakeBatchModel } from '../../features/intake/intake-batch.model';

export const ALL_MODELS = [
  UserModel, FacilityModel, UnitTypeModel, StorageUnitModel, ReservationModel, RentalContractModel,
  PaymentModel, InspectionModel, TicketModel, DamageClaimModel, PolicyModel, AuditLogModel, UnitSwapRequestModel,
  ServiceOfferingModel, ServiceOrderModel, AccessRequestModel, ContractTemplateModel, PrivacyRequestModel, EmailVerificationModel,
  IntakeBatchModel, GatewayOrderModel,
] as const;

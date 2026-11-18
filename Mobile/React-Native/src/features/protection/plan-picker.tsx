import { Text, View } from 'react-native';
import { CLAIM_CAUSE, CLAIM_CAUSES, PROTECTION_EXCLUSIONS, PROTECTION_PERILS, PROTECTION_PLAN_CODES, PROTECTION_PLANS, protectionFeeText, protectionLimitShort, type ClaimCause, type ProtectionPlanCode, type ProtectionPlanTable } from '@ssm/shared';
import { Disclosure, Muted, OptionCard } from '../../shared/ui';
import { C, S } from '../../shared/ui/theme';

/**
 * Chọn gói bảo vệ đồ gửi khi đặt kho (Điều 6, bản 1.20) — cùng gói và cách tính với web (@ssm/shared protection). Phí gói cộng vào tiền
 * thuê mỗi kỳ (server tính lại báo giá theo gói); mức gói Cơ bản theo thể tích ô của loại kho đang chọn.
 */
export function ProtectionPlanPicker({ value, onChange, volumeM3, plans = PROTECTION_PLANS }: {
  value: ProtectionPlanCode; onChange: (v: ProtectionPlanCode) => void; volumeM3?: number | null;
  /** Bảng gói theo chính sách của chi nhánh (protectionPlansOf). */
  plans?: ProtectionPlanTable;
}) {
  return (
    <View style={{ gap: S.sm }}>
      {PROTECTION_PLAN_CODES.map((code) => {
        const p = plans[code];
        return <OptionCard key={code} selected={value === code} onPress={() => onChange(code)} icon="shield-checkmark-outline"
          title={`Gói ${p.label} · ${protectionFeeText(p)}`} subtitle={`Chi trả ${protectionLimitShort(p, volumeM3)}/sự cố`} />;
      })}
      <Disclosure title="Gói chi trả khi nào?">
        <Muted>Chi trả thiệt hại thực tế, trong mức của gói, kể cả khi KhoAn không có lỗi, khi đồ bị: {PROTECTION_PERILS.join('; ').toLowerCase()}.</Muted>
        <Muted style={{ marginTop: 6 } as never}>Không chi trả: {PROTECTION_EXCLUSIONS.join('; ').toLowerCase()}.</Muted>
        <Muted style={{ marginTop: 6 } as never}>Lỗi của kho: tối đa 10 lần tiền thuê 1 tháng, không phụ thuộc gói.</Muted>
      </Disclosure>
    </View>
  );
}

/** Mức xét của một nguyên nhân trên thẻ chọn: lỗi kho 10 lần tiền thuê, rủi ro nêu tên theo gói, "Khác" chi nhánh xác định. */
const causeCapHint = (c: ClaimCause) => {
  const basis = CLAIM_CAUSE[c].basis;
  return basis === 'PLAN' ? 'Theo gói' : basis === 'FAULT' ? '10 lần tiền thuê 1 tháng' : 'Chi nhánh xác định mức';
};

/**
 * Chọn nguyên nhân sự cố khi gửi yêu cầu bồi thường — quyết định mức xét (lỗi kho: 10 lần tiền thuê 1 tháng; rủi ro nêu tên: theo gói;
 * "Khác": chưa có mức, chi nhánh xác định sau khi đọc Diễn biến). `value` null = chưa chọn (form không chọn sẵn).
 */
export function ClaimCausePicker({ value, onChange }: { value: ClaimCause | null; onChange: (v: ClaimCause) => void }) {
  return (
    <View style={{ gap: S.sm }}>
      {CLAIM_CAUSES.map((c) => (
        <OptionCard key={c} selected={value === c} onPress={() => onChange(c)}
          icon={c === 'FACILITY_FAULT' ? 'business-outline' : CLAIM_CAUSE[c].basis === 'OTHER' ? 'help-circle-outline' : 'warning-outline'}
          title={CLAIM_CAUSE[c].label} subtitle={`${causeCapHint(c)} · ${CLAIM_CAUSE[c].hint}`} />
      ))}
      <Text style={{ fontSize: 12, color: C.muted }}>Chi nhánh xác minh nguyên nhân trước khi duyệt.</Text>
    </View>
  );
}

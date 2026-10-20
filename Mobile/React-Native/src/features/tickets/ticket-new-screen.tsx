import { useState } from 'react';
import { StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { addDays, isClosedContract, ISSUE_TICKET_CATEGORIES, OPEN_CONTRACT_STATUSES, TICKET_CATEGORY, todayISO, TICKET_PRIORITY, TicketCategory, TicketPriority, enumValues } from '@ssm/shared';
import { facilityName, unitLabel, useStore } from '../../shared/store/store';
import { Button, Card, Chips, EmptyState, Field, Input, Screen, ScreenHeader } from '../../shared/ui';
import { S } from '../../shared/ui/theme';

const CATEGORY_OPTIONS = ISSUE_TICKET_CATEGORIES.map((k) => ({ value: k, label: TICKET_CATEGORY[k] }));
const PRIORITY_OPTIONS = enumValues(TicketPriority).map((k) => ({ value: k, label: TICKET_PRIORITY[k].label }));

export default function TicketNewScreen() {
  const { contract } = useLocalSearchParams<{ contract?: string }>();
  const { db, user, run } = useStore();
  const router = useRouter();

  // Hợp đồng đang thuê, hoặc vừa đóng trong 30 ngày (khiếu nại biên bản trả kho, nợ sau quyết toán…).
  const contracts = user ? db.contracts.filter((c) => c.customerId === user._id && (OPEN_CONTRACT_STATUSES.includes(c.status) || (isClosedContract(c.status) && (c.closedAt ?? '') >= addDays(todayISO(), -30)))) : [];
  const [contractId, setContractId] = useState(contract && contracts.some((c) => c._id === contract) ? contract : (contracts[0]?._id ?? ''));
  const [category, setCategory] = useState<TicketCategory>('MAINTENANCE');
  const [priority, setPriority] = useState<TicketPriority>('MEDIUM');
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');

  if (contracts.length === 0) {
    return (
      <Screen>
        <ScreenHeader title="Báo sự cố / yêu cầu hỗ trợ" />
        <EmptyState
          icon="cube-outline"
          title="Bạn chưa thuê kho nào"
          description="Cần có hợp đồng đang hiệu lực mới gửi được yêu cầu hỗ trợ."
        />
      </Screen>
    );
  }

  const c = contracts.find((x) => x._id === contractId) ?? contracts[0];
  const canSend = subject.trim().length > 0 && description.trim().length > 0;

  return (
    <Screen>
      <ScreenHeader title="Báo sự cố / yêu cầu hỗ trợ" />
      <Card>
        <Field label="Hợp đồng">
          <Chips
            options={contracts.map((x) => ({ value: x._id, label: `${unitLabel(db, x.unitId)} · ${facilityName(db, x.facilityId)}` }))}
            value={c._id}
            onChange={setContractId}
          />
        </Field>
        <Field label="Loại sự cố">
          <Chips options={CATEGORY_OPTIONS} value={category} onChange={setCategory} />
        </Field>
        <Field label="Mức ưu tiên">
          <Chips options={PRIORITY_OPTIONS} value={priority} onChange={setPriority} columns={2} />
        </Field>
        <Field label="Tiêu đề">
          <Input value={subject} onChangeText={setSubject} placeholder="Ví dụ: Khóa kho bị kẹt" />
        </Field>
        <Field label="Mô tả">
          <Input
            value={description} onChangeText={setDescription} placeholder="Mô tả chi tiết sự cố"
            multiline numberOfLines={4} style={st.multiline}
          />
        </Field>
        <Button
          title="Gửi yêu cầu"
          disabled={!canSend}
          onPress={() => void run(
            'createTicket',
            // Chỉ gắn ô kho khi hợp đồng còn mở — BE chỉ nhận ô của hợp đồng đang thuê (ô của hợp đồng đã đóng có thể đã cho người khác thuê).
            { facilityId: c.facilityId, category, priority, subject: subject.trim(), description: description.trim(), unitId: OPEN_CONTRACT_STATUSES.includes(c.status) ? c.unitId : undefined, contractId: c._id },
            'Đã gửi yêu cầu — chi nhánh sẽ phản hồi sớm',
            () => router.back(),
          )}
        />
      </Card>
    </Screen>
  );
}

const st = StyleSheet.create({
  multiline: { height: 100, paddingTop: S.sm, textAlignVertical: 'top' },
});

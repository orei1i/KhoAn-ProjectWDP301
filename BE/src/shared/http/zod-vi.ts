import { z } from 'zod';

/**
 * Thông báo lỗi tiếng Việt mặc định cho mọi schema zod của API. Chỉ áp khi schema không tự đặt `message` —
 * message riêng (regex, refine...) luôn được ưu tiên.
 */
const viErrorMap: z.ZodErrorMap = (issue, ctx) => {
  switch (issue.code) {
    case z.ZodIssueCode.invalid_type: {
      if (issue.received === 'undefined' || issue.received === 'null') return { message: 'Bắt buộc nhập' };
      if (issue.expected === 'integer') return { message: 'Phải là số nguyên' };
      if (issue.expected === 'number') return { message: 'Phải là số' };
      if (issue.expected === 'string') return { message: 'Phải là chuỗi ký tự' };
      if (issue.expected === 'boolean') return { message: 'Phải là đúng/sai' };
      return { message: 'Dữ liệu không đúng định dạng' };
    }
    case z.ZodIssueCode.too_small: {
      const min = Number(issue.minimum);
      if (issue.type === 'string') return { message: min <= 1 ? 'Không được để trống' : `Phải có ít nhất ${min} ký tự` };
      if (issue.type === 'number') return { message: issue.inclusive ? `Phải từ ${min} trở lên` : `Phải lớn hơn ${min}` };
      if (issue.type === 'array') return { message: `Cần ít nhất ${min} mục` };
      return { message: 'Giá trị quá nhỏ' };
    }
    case z.ZodIssueCode.too_big: {
      const max = Number(issue.maximum);
      if (issue.type === 'string') return { message: `Tối đa ${max} ký tự` };
      if (issue.type === 'number') return { message: issue.inclusive ? `Phải từ ${max} trở xuống` : `Phải nhỏ hơn ${max}` };
      if (issue.type === 'array') return { message: `Tối đa ${max} mục` };
      return { message: 'Giá trị quá lớn' };
    }
    case z.ZodIssueCode.invalid_string:
      return { message: issue.validation === 'email' ? 'Email không hợp lệ' : issue.validation === 'url' ? 'Đường dẫn không hợp lệ' : 'Sai định dạng' };
    case z.ZodIssueCode.invalid_enum_value:
      return { message: `Giá trị không hợp lệ (chọn một trong: ${issue.options.join(', ')})` };
    case z.ZodIssueCode.unrecognized_keys:
      return { message: `Có trường không được hỗ trợ: ${issue.keys.join(', ')}` };
    default:
      return { message: ctx.defaultError };
  }
};

z.setErrorMap(viErrorMap);

import { toast } from "sonner";
import type { ExternalToast } from "sonner";

export const showSuccess = (message: string, options?: ExternalToast) => {
  toast.success(message, options);
};

export const showError = (message: string, options?: ExternalToast) => {
  toast.error(message, options);
};

export const showLoading = (message: string) => {
  return toast.loading(message);
};

export const dismissToast = (toastId: string | number) => {
  toast.dismiss(toastId);
};
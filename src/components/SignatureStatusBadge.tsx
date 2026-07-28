import { ShieldCheck, ShieldAlert, ShieldQuestion, Lock, Unlock } from "lucide-react";
import * as Tooltip from "@radix-ui/react-tooltip";
import { useTranslation } from "react-i18next";

export interface SignatureStatusInfo {
  certificateStatus?: string;
  signerName?: string;
  signerIdentity?: string;
  organization?: string;
  teamId?: string;
  purchaserEmail?: string;
  isEncrypted?: boolean;
}

export default function SignatureStatusBadge({ info }: { info: SignatureStatusInfo }) {
  const { t } = useTranslation();
  const signerIdentity = info.signerIdentity?.trim();
  const organization = info.organization?.trim();
  const teamId = info.teamId?.trim();
  const signedByTooltip = signerIdentity
    ? t("signatureStatus.signedBy", { signer: signerIdentity })
    : null;

  let color = "bg-gray-100 text-gray-800";
  let icon = <ShieldQuestion size={14} className="mr-1" />;
  let text = t("signatureStatus.unknown");
  let tooltipText = t("signatureStatus.tooltipUnknown");

  switch (info.certificateStatus) {
    case "App Store":
      color = "bg-blue-100 text-blue-800";
      icon = <ShieldCheck size={14} className="mr-1" />;
      text = t("signatureStatus.appStore");
      tooltipText = info.purchaserEmail
        ? t("signatureStatus.purchasedBy", { email: info.purchaserEmail })
        : t("signatureStatus.purchasedFromAppStore");
      break;
    case "Enterprise":
      color = "bg-purple-100 text-purple-800";
      icon = <ShieldCheck size={14} className="mr-1" />;
      text = t("signatureStatus.enterprise");
      tooltipText = signedByTooltip
        ? signedByTooltip
        : t("signatureStatus.enterpriseSignature");
      break;
    case "Developer":
      color = "bg-green-100 text-green-800";
      icon = <ShieldCheck size={14} className="mr-1" />;
      text = t("signatureStatus.developer");
      tooltipText = signedByTooltip
        ? signedByTooltip
        : t("signatureStatus.developerSignature");
      break;
    case "Ad-Hoc":
      color = "bg-yellow-100 text-yellow-800";
      icon = <ShieldCheck size={14} className="mr-1" />;
      text = t("signatureStatus.adHoc");
      tooltipText = signedByTooltip
        ? signedByTooltip
        : t("signatureStatus.adHocSignature");
      break;
    case "Unsigned":
      color = "bg-red-100 text-red-800";
      icon = <ShieldAlert size={14} className="mr-1" />;
      text = t("signatureStatus.unsigned");
      tooltipText = t("signatureStatus.unsignedTooltip");
      break;
    default:
      break;
  }

  let encryptionIcon = null;
  const tooltipParts = [tooltipText];

  if (organization) {
    tooltipParts.push(t("signatureStatus.organization", { organization }));
  }

  if (teamId) {
    tooltipParts.push(t("signatureStatus.teamId", { teamId }));
  }

  if (info.isEncrypted !== undefined) {
    if (info.isEncrypted) {
      encryptionIcon = <Lock size={12} className="ml-1 opacity-60" />;
      tooltipParts.push(t("signatureStatus.encrypted"));
    } else {
      encryptionIcon = <Unlock size={12} className="ml-1 opacity-60" />;
      tooltipParts.push(t("signatureStatus.decrypted"));
    }
  }

  return (
    <Tooltip.Provider delayDuration={200}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <div className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${color} cursor-help`}>
            {icon}
            {text}
            {encryptionIcon}
          </div>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            className="bg-gray-900 text-white px-3 py-1.5 rounded text-xs shadow-xl z-50 max-w-xs break-words"
            sideOffset={5}
          >
            {tooltipParts.join(" • ")}
            <Tooltip.Arrow className="fill-gray-900" />
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}
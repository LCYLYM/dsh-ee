import { useTranslation } from "react-i18next";
import { PageHeader } from "../../components/ui";
import LdapSettings from "./ldap-settings";
import OidcSettings from "./oidc-settings";
import { Section } from "./settings";

/** 登录方式：LDAP / AD 与企业统一登录（OIDC），从系统设置拆出来。 */
export default function AdminAuth() {
  const { t } = useTranslation();
  return (
    <div className="max-w-3xl">
      <PageHeader title={t("pages.admin-auth")} desc={t("pageDesc.admin-auth")} />
      <div className="space-y-6">
        <Section id="auth-ldap" title={t("settingsAdmin.auth")} desc={t("settingsAdmin.authNote")}>
          <LdapSettings />
        </Section>
        <Section id="auth-oidc" title={t("oidcAdmin.title")}>
          <OidcSettings />
        </Section>
      </div>
    </div>
  );
}

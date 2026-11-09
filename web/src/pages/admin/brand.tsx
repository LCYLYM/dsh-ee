import { useTranslation } from "react-i18next";
import { Card, PageHeader } from "../../components/ui";
import BrandSettings from "./brand-settings";

/** 品牌与外观：从系统设置拆出来的独立页面，内容较多，需要更宽的版面放预览。 */
export default function AdminBrand() {
  const { t } = useTranslation();
  return (
    <div className="max-w-4xl">
      <PageHeader title={t("pages.admin-brand")} desc={t("brandAdmin.desc")} />
      <Card className="p-6">
        <BrandSettings />
      </Card>
    </div>
  );
}

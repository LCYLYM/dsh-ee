export interface BrandViewData {
  enabled: boolean;
  name: string;
  logo_url: string;
  revision: string;
}

export function brandMark(createElement: (...args: any[]) => any, brand: BrandViewData, props: { size?: number } = {}) {
  const size = props.size ?? 32;
  if (brand.logo_url) {
    return createElement("img", {
      src: brand.logo_url,
      alt: brand.name,
      width: size,
      height: size,
      style: { width: size, height: size, borderRadius: "50%", objectFit: "cover", display: "block" },
    });
  }
  const letter = (brand.name.trim().charAt(0) || "企").toUpperCase();
  return createElement("span", {
    "aria-label": brand.name,
    style: {
      width: size,
      height: size,
      borderRadius: "50%",
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      background: "#eef1f5",
      color: "#344054",
      fontSize: Math.max(12, Math.round(size * 0.42)),
      fontWeight: 600,
    },
  }, letter);
}

export function brandName(createElement: (...args: any[]) => any, brand: BrandViewData) {
  return createElement("span", { "data-dsh-ee-brand": brand.revision || "neutral" }, brand.name);
}

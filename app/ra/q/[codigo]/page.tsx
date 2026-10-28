import type { Metadata } from "next";
import QrCelular from "../../../../components/ra/QrCelular";

export const metadata: Metadata = {
  title: "Realidad aumentada",
  description: "Modelo BIM a escala real desde el celular.",
  robots: { index: false, follow: false },
};

/** Where a scanned QR lands on the phone (public: the code is the key). */
export default async function Page({ params }: { params: Promise<{ codigo: string }> }) {
  const { codigo } = await params;
  return <QrCelular codigo={codigo} />;
}

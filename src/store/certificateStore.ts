import { create } from "zustand";
import { persist } from "zustand/middleware";
import { goServiceClient, type Certificate } from "../lib/goService";

const CERTIFICATES_UPDATED_EVENT = "certificates:updated";

function notifyCertificatesUpdated() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(CERTIFICATES_UPDATED_EVENT));
  }
}

interface CertificateState {
  certificates: Certificate[];
  selectedCertificateId: string | null;
  isLoading: boolean;
  
  loadCertificates: () => Promise<void>;
  getDefaultCertificate: () => Certificate | null;
  setDefaultCertificate: (id: string) => Promise<void>;
  deleteCertificate: (id: string) => Promise<void>;
  importP12Certificate: (data: {
    name: string;
    p12Data?: string;
    provisionData?: string;
    zipData?: string;
    password: string;
    isDefault: boolean;
  }) => Promise<Certificate>;
  exportCertificate: (id: string) => Promise<{ fileName: string; contentType: string; data: Uint8Array }>;
  setSelectedCertificateId: (id: string | null) => void;
}

export const useCertificateStore = create<CertificateState>()(
  persist(
    (set, get) => ({
      certificates: [],
      selectedCertificateId: null,
      isLoading: false,

      loadCertificates: async () => {
        const hasCache = get().certificates.length > 0;
        if (!hasCache) {
          set({ isLoading: true });
        }
        try {
          const certs = await goServiceClient.listCertificates();
          set({ certificates: certs, isLoading: false });
          notifyCertificatesUpdated();
        } catch (error) {
          console.error("Failed to load certificates:", error);
          if (!hasCache) {
            set({ isLoading: false });
            throw error;
          }
          // When we have cache, keep UI responsive and avoid throwing
        }
      },

      getDefaultCertificate: () => {
        const { certificates } = get();
        return certificates.find((cert) => cert.is_default) || null;
      },

      setDefaultCertificate: async (id: string) => {
        await goServiceClient.setDefaultCertificate(id);
        const { certificates } = get();
        set({
          certificates: certificates.map((cert) => ({
            ...cert,
            is_default: cert.id === id,
          })),
        });
        notifyCertificatesUpdated();
      },

      deleteCertificate: async (id: string) => {
        await goServiceClient.deleteCertificate(id);
        const { certificates } = get();
        set({
          certificates: certificates.filter((cert) => cert.id !== id),
        });
        notifyCertificatesUpdated();
      },

      importP12Certificate: async (data) => {
        const requestData: any = {
          name: data.name,
          password: data.password,
          is_default: data.isDefault,
        };
        
        if (data.zipData) {
          requestData.zip_data = data.zipData;
        } else {
          requestData.p12_data = data.p12Data;
          requestData.provision_data = data.provisionData;
        }
        
        const cert = await goServiceClient.importP12Certificate(requestData);
        const { certificates } = get();
        
        let updatedCerts = [...certificates, cert];
        
        if (data.isDefault) {
          updatedCerts = updatedCerts.map((c) => ({
            ...c,
            is_default: c.id === cert.id,
          }));
        }
        
        set({ certificates: updatedCerts });
        notifyCertificatesUpdated();
        return cert;
      },

      exportCertificate: async (id) => {
		return goServiceClient.exportCertificate(id);
	  },

      setSelectedCertificateId: (id: string | null) => {
        set({ selectedCertificateId: id });
      },
    }),
    {
      name: "certificate-store",
      partialize: (state) => ({
        selectedCertificateId: state.selectedCertificateId,
      }),
    }
  )
);


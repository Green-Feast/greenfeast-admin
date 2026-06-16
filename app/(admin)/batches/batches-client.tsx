"use client";

import { useState, useMemo } from "react";
import { GripVertical, MoreVertical, Plus, X, AlertCircle, Phone, MapPin, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/* ─── Data ─────────────────────────────────────────────────────────────── */

type Subscriber = {
  id: string;
  code: string;
  name: string;
  phone: string;
  meal: string;
  constraints: string;
  addons: string;
  driverId: string | null;
};

type Driver = {
  id: string;
  name: string;
  age: number;
  phone: string;
  areas: string[];
  subscriberCount: number;
  capacity: number;
  joinDate: string;
  status: "active" | "onleave" | "inactive";
};

const initialSubscribers: Subscriber[] = [
  { id: "N/C/01", code: "N/C/01", name: "Nitika Shilp Sangam", phone: "7610030677", meal: "Asian Bowl", constraints: "Extra Paneer", addons: "", driverId: "nami" },
  { id: "N/C/02", code: "N/C/02", name: "Aanchal", phone: "9782212557", meal: "Asian Bowl", constraints: "No Buddha Avo protein", addons: "", driverId: "nami" },
  { id: "N/C/03", code: "N/C/03", name: "Hiya", phone: "9571660678", meal: "Asian Bowl", constraints: "No peanut, No Pesto", addons: "", driverId: "nami" },
  { id: "N/C/04", code: "N/C/04", name: "Dr. Nisha", phone: "8080475554", meal: "Asian Bowl", constraints: "No Bell pepper", addons: "", driverId: "nami" },
  { id: "N/C/05", code: "N/C/05", name: "Dr. Ishika Nanda", phone: "8171675992", meal: "Asian Bowl", constraints: "Extra Lettuce", addons: "", driverId: "nami" },
  { id: "N/C/06", code: "N/C/06", name: "Jasleen", phone: "9815406442", meal: "Asian Bowl", constraints: "No pasta", addons: "", driverId: "nami" },
  { id: "N/C/07", code: "N/C/07", name: "Dr. Muskan Jindal", phone: "9971414065", meal: "Asian Bowl", constraints: "ALLERGIC TO QUINOA", addons: "", driverId: "nami" },
  { id: "N/C/08", code: "N/C/08", name: "Karan Dutt", phone: "8628072700", meal: "Asian Bowl", constraints: "use quinoa", addons: "Smoothies", driverId: "nami" },
  { id: "N/C/09", code: "N/C/09", name: "Dr. Gurusha Kausal", phone: "8955652679", meal: "Asian Bowl", constraints: "NO PANEER", addons: "", driverId: "nami" },
  { id: "N/R/10", code: "N/R/10", name: "Pallavi Bhadu", phone: "9782946260", meal: "Asian Bowl", constraints: "", addons: "", driverId: "nami" },
  { id: "N/R/11", code: "N/R/11", name: "Shweta Khari", phone: "7290929167", meal: "Asian Bowl", constraints: "", addons: "", driverId: "nami" },
  { id: "N/R/12", code: "N/R/12", name: "Abhimanyu Sinha", phone: "9172220043", meal: "Thai Gen", constraints: "Mexican, Soya panini", addons: "", driverId: "nami" },
  { id: "N/R/13", code: "N/R/13", name: "Nitika Sood", phone: "8094502015", meal: "Asian Bowl", constraints: "", addons: "", driverId: "nami" },
  { id: "N/R/14", code: "N/R/14", name: "Roushan", phone: "7999651946", meal: "Asian Bowl", constraints: "", addons: "", driverId: "nami" },
  { id: "N/R/15", code: "N/R/15", name: "Prakriti Jamne", phone: "7509751551", meal: "Asian Bowl", constraints: "", addons: "", driverId: "nami" },
  { id: "N/R/16", code: "N/R/16", name: "Dr Sarah Chawla", phone: "7073777345", meal: "Asian Bowl", constraints: "", addons: "", driverId: "nami" },
  { id: "R/C/01", code: "R/C/01", name: "Ankit Chitlangiya", phone: "9829005037", meal: "Asian Bowl", constraints: "Dressing Outside", addons: "Extra protein", driverId: "rahul" },
  { id: "R/C/02", code: "R/C/02", name: "Deepanshu Sarda", phone: "9460102650", meal: "Asian Bowl", constraints: "No Mushrooms", addons: "Extra Protein", driverId: "rahul" },
  { id: "R/C/03", code: "R/C/03", name: "Vandana Chandana", phone: "9829648888", meal: "Asian Bowl", constraints: "GLUTEN FREE", addons: "", driverId: "rahul" },
  { id: "R/C/04", code: "R/C/04", name: "Gunjan Khandelwal", phone: "9829993434", meal: "Asian Bowl", constraints: "No Mushroom", addons: "", driverId: "rahul" },
  { id: "R/R/05", code: "R/R/05", name: "Muskan Karnawat", phone: "9828899959", meal: "Asian Bowl", constraints: "", addons: "", driverId: "rahul" },
  { id: "R/R/06", code: "R/R/06", name: "Arvind Gupta", phone: "9829050571", meal: "Asian Bowl", constraints: "2 Meals", addons: "", driverId: "rahul" },
  { id: "R/R/07", code: "R/R/07", name: "Siddharth Pruthi", phone: "9784017972", meal: "Asian Bowl", constraints: "", addons: "", driverId: "rahul" },
  { id: "Y/C/01", code: "Y/C/01", name: "Sonal Mendiratta", phone: "9829722323", meal: "Asian Bowl", constraints: "", addons: "EXTRA PROTEIN", driverId: "yashpal" },
  { id: "Y/C/02", code: "Y/C/02", name: "Rahul Janani", phone: "9829160415", meal: "Asian Bowl", constraints: "No salt", addons: "", driverId: "yashpal" },
  { id: "Y/C/03", code: "Y/C/03", name: "Rohit Thawrani", phone: "9509508345", meal: "Asian Bowl", constraints: "No carbs", addons: "Extra protein", driverId: "yashpal" },
  { id: "Y/C/04", code: "Y/C/04", name: "Pratyush Agarwal", phone: "9929407481", meal: "Peri Peri Panini", constraints: "", addons: "Extra Protein", driverId: "yashpal" },
  { id: "Y/C/05", code: "Y/C/05", name: "Dr. Charul", phone: "9001024212", meal: "Umami Soba Bowl", constraints: "No lettuce", addons: "", driverId: "yashpal" },
  { id: "Y/C/06", code: "Y/C/06", name: "Dr. Sanjana Somani", phone: "9873848847", meal: "Asian Bowl", constraints: "Less quinoa", addons: "", driverId: "yashpal" },
  { id: "Y/C/07", code: "Y/C/07", name: "Utsav Sharma", phone: "8302648202", meal: "Asian Bowl", constraints: "NO Quinoa", addons: "", driverId: "yashpal" },
  { id: "Y/C/08", code: "Y/C/08", name: "Puru", phone: "8955708287", meal: "Asian Bowl", constraints: "NO mushroom", addons: "", driverId: "yashpal" },
  { id: "Y/R/09", code: "Y/R/09", name: "Prasant", phone: "7023822610", meal: "Asian Bowl", constraints: "", addons: "", driverId: "yashpal" },
  { id: "Y/R/10", code: "Y/R/10", name: "Raghav Agarwal", phone: "9782741432", meal: "Asian Bowl", constraints: "", addons: "", driverId: "yashpal" },
  { id: "Y/R/11", code: "Y/R/11", name: "Dr. Gaurav", phone: "9929471752", meal: "Asian Bowl", constraints: "", addons: "", driverId: "yashpal" },
  { id: "Y/R/12", code: "Y/R/12", name: "Arihant Dhadda", phone: "9828018090", meal: "Umami Soba Bowl", constraints: "", addons: "", driverId: "yashpal" },
  { id: "S/C/01", code: "S/C/01", name: "Aditii Sisodiya", phone: "9820415361", meal: "Asian Bowl", constraints: "Less carbs", addons: "", driverId: "santu" },
  { id: "S/C/02", code: "S/C/02", name: "Dr. Shivam", phone: "9992787315", meal: "Asian Bowl", constraints: "No Papaya", addons: "", driverId: "santu" },
  { id: "S/C/03", code: "S/C/03", name: "Dr. Sidhant", phone: "8225000777", meal: "Asian Bowl", constraints: "Gluten Free", addons: "", driverId: "santu" },
  { id: "S/C/04", code: "S/C/04", name: "Dr. Ashray Jain", phone: "6387668569", meal: "Tropical Fruit Salad", constraints: "", addons: "Extra spicy smoothie", driverId: "santu" },
  { id: "S/C/05", code: "S/C/05", name: "Anant", phone: "8619957997", meal: "Mexican Fiesta Bowl", constraints: "More dressing", addons: "", driverId: "santu" },
  { id: "S/C/06", code: "S/C/06", name: "Surabhi Pannu", phone: "9636456512", meal: "Asian Bowl", constraints: "DAIRY FREE", addons: "", driverId: "santu" },
  { id: "S/C/07", code: "S/C/07", name: "Ashwin Ji", phone: "7021139318", meal: "Asian Bowl", constraints: "Less Carbs", addons: "Extra protein", driverId: "santu" },
  { id: "S/C/08", code: "S/C/08", name: "Akash Chauhan", phone: "8233186472", meal: "Asian Bowl", constraints: "No Pasta", addons: "", driverId: "santu" },
  { id: "S/C/09", code: "S/C/09", name: "Giri Raj", phone: "7568387373", meal: "Asian Bowl", constraints: "Extra Paneer", addons: "Avo Protein", driverId: "santu" },
  { id: "S/R/10", code: "S/R/10", name: "Bharti Maheshwari", phone: "8742067974", meal: "Asian Bowl", constraints: "", addons: "", driverId: "santu" },
  { id: "S/R/11", code: "S/R/11", name: "Dr. Sudhanshu", phone: "7415010737", meal: "Asian Bowl", constraints: "", addons: "", driverId: "santu" },
  { id: "S/R/12", code: "S/R/12", name: "Rishabh Rao", phone: "7976287022", meal: "Panini", constraints: "", addons: "", driverId: "santu" },
  { id: "E/C/01", code: "E/C/01", name: "Praveen Vijayvegiya", phone: "9982613131", meal: "Asian Bowl", constraints: "EXTRA Protein", addons: "", driverId: "evening" },
  { id: "E/C/02", code: "E/C/02", name: "Shubham Gangwal", phone: "9597445822", meal: "Asian Bowl", constraints: "NO AVOCADO", addons: "2 Egg", driverId: "evening" },
  { id: "E/C/03", code: "E/C/03", name: "Shivani Puri", phone: "9982511715", meal: "Asian Bowl", constraints: "Chipotle dressing", addons: "EXTRA PROTEIN", driverId: "evening" },
  { id: "E/C/04", code: "E/C/04", name: "Aman Dua", phone: "7597092777", meal: "Quinoa Buddha Bowl", constraints: "No beetroot", addons: "2 Meals", driverId: "evening" },
  { id: "E/R/05", code: "E/R/05", name: "Mukesh Rela", phone: "9829066110", meal: "Asian Bowl", constraints: "", addons: "", driverId: "evening" },
  { id: "E/R/06", code: "E/R/06", name: "Harshit Sachdeva", phone: "9660612829", meal: "Asian Bowl", constraints: "", addons: "", driverId: "evening" },
];

const initialDrivers: Driver[] = [
  { id: "nami", name: "Nami", age: 32, phone: "9876543210", areas: ["Sitapura", "Jagatpura", "JNU Area"], subscriberCount: 16, capacity: 25, joinDate: "2024-01-15", status: "active" },
  { id: "rahul", name: "Rahul", age: 28, phone: "9876543211", areas: ["Durgapura", "Tonk Road", "Mansarovar"], subscriberCount: 7, capacity: 25, joinDate: "2023-11-20", status: "active" },
  { id: "yashpal", name: "Yashpal", age: 35, phone: "9876543212", areas: ["C-Scheme", "Jawahar Nagar", "Malviya Nagar"], subscriberCount: 12, capacity: 25, joinDate: "2023-09-10", status: "active" },
  { id: "santu", name: "Santu", age: 26, phone: "9876543213", areas: ["Civil Lines", "Lal Kothi", "Hawa Sadak"], subscriberCount: 12, capacity: 25, joinDate: "2024-02-01", status: "active" },
  { id: "evening", name: "Evening", age: 30, phone: "9876543214", areas: ["Mahaveer Nagar", "Tonk Road Evening"], subscriberCount: 6, capacity: 25, joinDate: "2023-12-05", status: "active" },
];

const driverColors: Record<string, { bg: string; border: string; text: string }> = {
  nami: { bg: "bg-teal-50", border: "border-teal-200", text: "text-teal-700" },
  rahul: { bg: "bg-purple-50", border: "border-purple-200", text: "text-purple-700" },
  yashpal: { bg: "bg-orange-50", border: "border-orange-200", text: "text-orange-700" },
  santu: { bg: "bg-pink-50", border: "border-pink-200", text: "text-pink-700" },
  evening: { bg: "bg-amber-50", border: "border-amber-200", text: "text-amber-700" },
};

/* ─── Components ────────────────────────────────────────────────────────── */

function Toast({ message }: { message: string }) {
  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-[#1A1A1A] text-white text-sm px-4 py-2.5 rounded-lg shadow-lg animate-in fade-in slide-in-from-bottom-2 duration-200">
      {message}
    </div>
  );
}

function DriverCard({ driver, isSelected, onClick, onMenuClick }: { driver: Driver; isSelected: boolean; onClick: () => void; onMenuClick: (e: React.MouseEvent, action: string) => void }) {
  const unassignedCount = driver.subscriberCount;
  const isFull = unassignedCount >= driver.capacity;
  const statusColor = driver.status === "active" ? "bg-green-100 text-green-800" : driver.status === "onleave" ? "bg-yellow-100 text-yellow-800" : "bg-gray-100 text-gray-800";
  const areaDisplay = driver.areas.slice(0, 2).join(", ") + (driver.areas.length > 2 ? `... +${driver.areas.length - 2} more` : "");

  return (
    <div
      onClick={onClick}
      className={cn(
        "flex-shrink-0 p-3 rounded-lg border-2 cursor-pointer transition-all w-72",
        isSelected ? "border-[#1B5E20] bg-[#F9FBF7]" : "border-gray-200 bg-white hover:border-gray-300"
      )}
    >
      <div className="flex items-start justify-between mb-2">
        <div>
          <p className="font-semibold text-[#1A1A1A]">{driver.name}</p>
          <p className="text-xs text-gray-600">{driver.age} years · <a href={`tel:${driver.phone}`} className="text-blue-600 hover:underline">{driver.phone}</a></p>
        </div>
        <button onClick={(e) => onMenuClick(e, "menu")} className="p-1 hover:bg-gray-100 rounded">
          <MoreVertical className="w-4 h-4 text-gray-500" />
        </button>
      </div>
      <div className="flex items-center justify-between mb-2">
        <div className="flex gap-1 flex-wrap">
          {driver.areas.slice(0, 2).map((area, idx) => (
            <span key={idx} className="text-xs bg-gray-100 text-gray-700 px-2 py-1 rounded">
              {area}
            </span>
          ))}
          {driver.areas.length > 2 && <span className="text-xs bg-gray-100 text-gray-700 px-2 py-1 rounded">+{driver.areas.length - 2}</span>}
        </div>
      </div>
      <div className="flex items-center justify-between">
        <span className={`text-sm font-medium ${isFull ? "text-red-600" : "text-[#1A1A1A]"}`}>
          {unassignedCount} / {driver.capacity}
          {isFull && <AlertCircle className="w-4 h-4 inline ml-1" />}
        </span>
        <span className={`text-xs px-2 py-1 rounded-full ${statusColor}`}>
          {driver.status === "active" ? "Active" : driver.status === "onleave" ? "On Leave" : "Inactive"}
        </span>
      </div>
    </div>
  );
}

function SubscriberCard({ subscriber, isDragging }: { subscriber: Subscriber; isDragging: boolean }) {
  return (
    <div className={cn("p-3 rounded-lg border border-gray-200 bg-white hover:shadow-md transition-all cursor-grab active:cursor-grabbing", isDragging && "opacity-50")} draggable>
      <div className="flex items-start gap-2 mb-1">
        <GripVertical className="w-4 h-4 text-gray-400 flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="font-medium text-sm text-[#1A1A1A] truncate">{subscriber.name}</p>
          <p className="text-xs text-gray-600 truncate">{subscriber.code}</p>
          <p className="text-xs text-gray-600 truncate">{subscriber.phone}</p>
        </div>
      </div>
      <div className="ml-6 text-xs space-y-1">
        <p className="text-gray-700">{subscriber.meal}</p>
        {subscriber.constraints && <p className="text-gray-600 truncate" title={subscriber.constraints}>{subscriber.constraints}</p>}
      </div>
    </div>
  );
}

function AddDriverModal({ isOpen, onClose, onAdd }: { isOpen: boolean; onClose: () => void; onAdd: (driver: Omit<Driver, "subscriberCount">) => void }) {
  const [formData, setFormData] = useState({ name: "", age: "", phone: "", areas: "", capacity: "25" });

  const handleSubmit = () => {
    if (!formData.name || !formData.age || !formData.phone || !formData.areas) return;
    onAdd({
      id: `driver-${Date.now()}`,
      name: formData.name,
      age: parseInt(formData.age),
      phone: formData.phone,
      areas: formData.areas.split(",").map((a) => a.trim()),
      capacity: parseInt(formData.capacity),
      joinDate: new Date().toISOString().split("T")[0],
      status: "active",
    });
    setFormData({ name: "", age: "", phone: "", areas: "", capacity: "25" });
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-lg max-w-md w-full p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold text-[#1A1A1A]">Add New Driver</h2>
          <button onClick={onClose}>
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="space-y-4">
          <input placeholder="Driver Name" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#1B5E20]" />
          <input type="number" placeholder="Age" value={formData.age} onChange={(e) => setFormData({ ...formData, age: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#1B5E20]" />
          <input type="tel" placeholder="Phone" value={formData.phone} onChange={(e) => setFormData({ ...formData, phone: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#1B5E20]" />
          <textarea placeholder="Areas (comma-separated)" value={formData.areas} onChange={(e) => setFormData({ ...formData, areas: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#1B5E20] resize-none h-20" />
          <input type="number" placeholder="Capacity" value={formData.capacity} onChange={(e) => setFormData({ ...formData, capacity: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#1B5E20]" />
        </div>
        <div className="flex gap-3 mt-6">
          <button onClick={onClose} className="flex-1 px-4 py-2 border border-gray-300 text-[#1A1A1A] rounded-lg hover:bg-gray-50 font-medium text-sm">
            Cancel
          </button>
          <button onClick={handleSubmit} className="flex-1 px-4 py-2 bg-[#1B5E20] text-white rounded-lg hover:bg-[#145214] font-medium text-sm">
            Create Driver
          </button>
        </div>
      </div>
    </div>
  );
}

function EditDriverModal({ isOpen, onClose, driver, onSave }: { isOpen: boolean; onClose: () => void; driver: Driver | null; onSave: (driver: Driver) => void }) {
  const [formData, setFormData] = useState(driver ? { name: driver.name, age: driver.age.toString(), phone: driver.phone, areas: driver.areas.join(", "), capacity: driver.capacity.toString() } : { name: "", age: "", phone: "", areas: "", capacity: "25" });

  const handleSubmit = () => {
    if (!driver || !formData.name || !formData.age || !formData.phone || !formData.areas) return;
    onSave({ ...driver, name: formData.name, age: parseInt(formData.age), phone: formData.phone, areas: formData.areas.split(",").map((a) => a.trim()), capacity: parseInt(formData.capacity) });
    onClose();
  };

  if (!isOpen || !driver) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-lg max-w-md w-full p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold text-[#1A1A1A]">Edit Driver</h2>
          <button onClick={onClose}>
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="space-y-4">
          <input placeholder="Driver Name" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#1B5E20]" />
          <input type="number" placeholder="Age" value={formData.age} onChange={(e) => setFormData({ ...formData, age: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#1B5E20]" />
          <input type="tel" placeholder="Phone" value={formData.phone} onChange={(e) => setFormData({ ...formData, phone: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#1B5E20]" />
          <textarea placeholder="Areas (comma-separated)" value={formData.areas} onChange={(e) => setFormData({ ...formData, areas: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#1B5E20] resize-none h-20" />
          <input type="number" placeholder="Capacity" value={formData.capacity} onChange={(e) => setFormData({ ...formData, capacity: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#1B5E20]" />
        </div>
        <div className="flex gap-3 mt-6">
          <button onClick={onClose} className="flex-1 px-4 py-2 border border-gray-300 text-[#1A1A1A] rounded-lg hover:bg-gray-50 font-medium text-sm">
            Cancel
          </button>
          <button onClick={handleSubmit} className="flex-1 px-4 py-2 bg-[#1B5E20] text-white rounded-lg hover:bg-[#145214] font-medium text-sm">
            Save Changes
          </button>
        </div>
      </div>
    </div>
  );
}

function ViewDetailsModal({ isOpen, onClose, driver, subscribers }: { isOpen: boolean; onClose: () => void; driver: Driver | null; subscribers: Subscriber[] }) {
  if (!isOpen || !driver) return null;

  const driverSubs = subscribers.filter((s) => s.driverId === driver.id);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-lg max-w-md w-full max-h-96 overflow-y-auto p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold text-[#1A1A1A]">Driver Details</h2>
          <button onClick={onClose}>
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="space-y-4">
          <div>
            <p className="text-sm text-gray-600">Name</p>
            <p className="text-sm font-medium text-[#1A1A1A]">{driver.name}</p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-sm text-gray-600">Age</p>
              <p className="text-sm font-medium text-[#1A1A1A]">{driver.age}</p>
            </div>
            <div>
              <p className="text-sm text-gray-600">Phone</p>
              <a href={`tel:${driver.phone}`} className="text-sm font-medium text-blue-600 hover:underline">
                {driver.phone}
              </a>
            </div>
          </div>
          <div>
            <p className="text-sm text-gray-600">Areas</p>
            <div className="flex flex-wrap gap-1 mt-1">
              {driver.areas.map((area, idx) => (
                <span key={idx} className="text-xs bg-gray-100 text-gray-700 px-2 py-1 rounded">
                  {area}
                </span>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-sm text-gray-600">Capacity</p>
              <p className="text-sm font-medium text-[#1A1A1A]">{driver.subscriberCount} / {driver.capacity}</p>
            </div>
            <div>
              <p className="text-sm text-gray-600">Join Date</p>
              <p className="text-sm font-medium text-[#1A1A1A]">{driver.joinDate}</p>
            </div>
          </div>
          <div>
            <p className="text-sm text-gray-600 mb-2">Assigned Subscribers ({driverSubs.length})</p>
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {driverSubs.length === 0 ? (
                <p className="text-xs text-gray-500">No subscribers assigned</p>
              ) : (
                driverSubs.map((sub) => (
                  <div key={sub.id} className="text-xs text-gray-700 p-2 bg-gray-50 rounded">
                    <p className="font-medium">{sub.name}</p>
                    <p className="text-gray-600">{sub.phone}</p>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
        <button onClick={onClose} className="w-full mt-6 px-4 py-2 bg-gray-100 text-[#1A1A1A] rounded-lg hover:bg-gray-200 font-medium text-sm">
          Close
        </button>
      </div>
    </div>
  );
}

function DeleteDriverModal({ isOpen, onClose, driver, onDelete, onReassign }: { isOpen: boolean; onClose: () => void; driver: Driver | null; onDelete: () => void; onReassign: () => void }) {
  if (!isOpen || !driver) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-lg max-w-md w-full p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold text-[#1A1A1A]">Delete Driver</h2>
          <button onClick={onClose}>
            <X className="w-5 h-5" />
          </button>
        </div>
        <p className="text-sm text-gray-700 mb-4">
          Delete driver <strong>{driver.name}</strong>?
        </p>
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 mb-4">
          <p className="text-sm text-yellow-800">
            <AlertCircle className="w-4 h-4 inline mr-2" />
            This will move all {driver.subscriberCount} subscribers to Unassigned
          </p>
        </div>
        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 px-4 py-2 border border-gray-300 text-[#1A1A1A] rounded-lg hover:bg-gray-50 font-medium text-sm">
            Cancel
          </button>
          <button onClick={onDelete} className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 font-medium text-sm">
            Delete & Move
          </button>
        </div>
      </div>
    </div>
  );
}

export default function BatchesClient() {
  const [drivers, setDrivers] = useState<Driver[]>(initialDrivers);
  const [subscribers, setSubscribers] = useState<Subscriber[]>(initialSubscribers);
  const [selectedDriverId, setSelectedDriverId] = useState<string | null>(null);
  const [draggedSubscriber, setDraggedSubscriber] = useState<Subscriber | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [modals, setModals] = useState({ addDriver: false, editDriver: false, viewDetails: false, deleteDriver: false });
  const [selectedDriver, setSelectedDriver] = useState<Driver | null>(null);
  const [menuDriver, setMenuDriver] = useState<string | null>(null);

  const unassignedCount = subscribers.filter((s) => !s.driverId).length;
  const activeDriversCount = drivers.filter((d) => d.status === "active").length;
  const totalSubscribers = subscribers.length;

  const handleAddDriver = (newDriver: Omit<Driver, "subscriberCount">) => {
    const driver: Driver = { ...newDriver, subscriberCount: 0 };
    setDrivers([...drivers, driver]);
    showToast(`Driver ${newDriver.name} added`);
    setModals({ ...modals, addDriver: false });
  };

  const handleEditDriver = (updatedDriver: Driver) => {
    setDrivers(drivers.map((d) => (d.id === updatedDriver.id ? updatedDriver : d)));
    showToast(`Driver updated`);
    setModals({ ...modals, editDriver: false });
  };

  const handleDeleteDriver = (driverId: string) => {
    const subs = subscribers.filter((s) => s.driverId === driverId);
    setSubscribers(subs.map((s) => ({ ...s, driverId: null })));
    setDrivers(drivers.filter((d) => d.id !== driverId));
    showToast(`Driver deleted, ${subs.length} subscribers moved to Unassigned`);
    setModals({ ...modals, deleteDriver: false });
    setMenuDriver(null);
  };

  const handleToggleLeave = (driverId: string) => {
    setDrivers(
      drivers.map((d) =>
        d.id === driverId ? { ...d, status: d.status === "active" ? "onleave" : "active" } : d
      )
    );
    const driver = drivers.find((d) => d.id === driverId);
    if (driver) showToast(`${driver.name} status updated`);
    setMenuDriver(null);
  };

  const handleDragStart = (e: React.DragEvent, subscriber: Subscriber) => {
    setDraggedSubscriber(subscriber);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  const handleDropOnDriver = (driverId: string) => {
    if (!draggedSubscriber) return;
    const oldDriverId = draggedSubscriber.driverId;
    setSubscribers(
      subscribers.map((s) =>
        s.id === draggedSubscriber.id ? { ...s, driverId } : s
      )
    );
    const driver = drivers.find((d) => d.id === driverId);
    if (driver) showToast(`${draggedSubscriber.name} → ${driver.name}`);
    setDraggedSubscriber(null);
  };

  const handleDropOnUnassigned = () => {
    if (!draggedSubscriber) return;
    setSubscribers(
      subscribers.map((s) =>
        s.id === draggedSubscriber.id ? { ...s, driverId: null } : s
      )
    );
    showToast(`${draggedSubscriber.name} unassigned`);
    setDraggedSubscriber(null);
  };

  const openDriverMenu = (driverId: string, action: string) => {
    const driver = drivers.find((d) => d.id === driverId);
    if (!driver) return;

    switch (action) {
      case "edit":
        setSelectedDriver(driver);
        setModals({ ...modals, editDriver: true });
        break;
      case "viewDetails":
        setSelectedDriver(driver);
        setModals({ ...modals, viewDetails: true });
        break;
      case "delete":
        setSelectedDriver(driver);
        setModals({ ...modals, deleteDriver: true });
        break;
      case "leave":
        handleToggleLeave(driverId);
        break;
    }
  };

  const showToast = (message: string) => {
    setToast(message);
    setTimeout(() => setToast(null), 2000);
  };

  const getDriverSubscribers = (driverId: string | null) => subscribers.filter((s) => s.driverId === driverId);

  return (
    <div className="flex flex-col h-full bg-[#F9FBF7]">
      {/* Header */}
      <div className="px-6 py-6 bg-white border-b border-gray-200">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-bold text-[#1A1A1A]">Batch & Driver Management</h1>
            <p className="text-sm text-gray-600 mt-1">Manage delivery drivers and reassign subscribers</p>
          </div>
          <button onClick={() => setModals({ ...modals, addDriver: true })} className="flex items-center gap-2 px-4 py-2 bg-[#1B5E20] text-white rounded-lg hover:bg-[#145214] font-medium text-sm">
            <Plus className="w-4 h-4" />
            Add New Driver
          </button>
        </div>
        <div className="flex gap-6 text-sm">
          <div>
            <p className="text-gray-600">{activeDriversCount} active drivers</p>
          </div>
          <div>
            <p className="text-gray-600">{totalSubscribers} subscribers</p>
          </div>
          <div>
            <p className="text-gray-600">{unassignedCount} unassigned</p>
          </div>
        </div>
      </div>

      {/* Drivers List */}
      <div className="px-6 py-4 overflow-x-auto">
        <div className="flex gap-3">
          {drivers.map((driver) => (
            <div key={driver.id} className="relative">
              <DriverCard
                driver={driver}
                isSelected={selectedDriverId === driver.id}
                onClick={() => setSelectedDriverId(driver.id)}
                onMenuClick={(e, action) => {
                  e.stopPropagation();
                  setMenuDriver(menuDriver === driver.id ? null : driver.id);
                }}
              />
              {menuDriver === driver.id && (
                <div className="absolute top-12 right-0 bg-white border border-gray-200 rounded-lg shadow-lg z-10 min-w-max">
                  <button onClick={() => openDriverMenu(driver.id, "edit")} className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 border-b">
                    Edit
                  </button>
                  <button onClick={() => openDriverMenu(driver.id, "viewDetails")} className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 border-b">
                    View Details
                  </button>
                  <button onClick={() => openDriverMenu(driver.id, "leave")} className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 border-b">
                    {driver.status === "active" ? "Mark On Leave" : "Mark Active"}
                  </button>
                  <button onClick={() => openDriverMenu(driver.id, "delete")} className="block w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50">
                    Delete
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Drag-Drop Board */}
      <div className="flex-1 px-6 py-4 overflow-x-auto">
        <div className="flex gap-4 min-w-max">
          {/* Unassigned Column */}
          <div className="flex-shrink-0 w-80 flex flex-col bg-gray-50 rounded-lg border-2 border-gray-200">
            <div className="p-3 bg-gray-100 border-b border-gray-200 rounded-t-md">
              <p className="font-semibold text-gray-700">Unassigned</p>
              <p className="text-xs text-gray-600">{unassignedCount} subscribers</p>
            </div>
            <div
              onDragOver={handleDragOver}
              onDrop={handleDropOnUnassigned}
              className="flex-1 p-3 space-y-2 overflow-y-auto min-h-96"
            >
              {getDriverSubscribers(null).map((sub) => (
                <div key={sub.id} onDragStart={(e) => handleDragStart(e, sub)}>
                  <SubscriberCard subscriber={sub} isDragging={draggedSubscriber?.id === sub.id} />
                </div>
              ))}
            </div>
          </div>

          {/* Driver Columns */}
          {drivers.map((driver) => (
            <div key={driver.id} className="flex-shrink-0 w-80 flex flex-col bg-white rounded-lg border-2 border-gray-200">
              <div className={cn("p-3 rounded-t-md border-b border-gray-200", driverColors[driver.id]?.bg || "bg-gray-50")}>
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <p className={`font-semibold ${driverColors[driver.id]?.text || "text-gray-700"}`}>{driver.name}</p>
                    <p className="text-xs text-gray-600">{driver.phone}</p>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-700">{getDriverSubscribers(driver.id).length} / {driver.capacity}</span>
                  {driver.status !== "active" && <span className="text-xs px-2 py-1 bg-yellow-100 text-yellow-800 rounded">On Leave</span>}
                </div>
              </div>
              <div
                onDragOver={handleDragOver}
                onDrop={() => handleDropOnDriver(driver.id)}
                className="flex-1 p-3 space-y-2 overflow-y-auto min-h-96"
              >
                {getDriverSubscribers(driver.id).map((sub) => (
                  <div key={sub.id} onDragStart={(e) => handleDragStart(e, sub)}>
                    <SubscriberCard subscriber={sub} isDragging={draggedSubscriber?.id === sub.id} />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Modals */}
      <AddDriverModal isOpen={modals.addDriver} onClose={() => setModals({ ...modals, addDriver: false })} onAdd={handleAddDriver} />
      <EditDriverModal isOpen={modals.editDriver} onClose={() => setModals({ ...modals, editDriver: false })} driver={selectedDriver} onSave={handleEditDriver} />
      <ViewDetailsModal isOpen={modals.viewDetails} onClose={() => setModals({ ...modals, viewDetails: false })} driver={selectedDriver} subscribers={subscribers} />
      <DeleteDriverModal isOpen={modals.deleteDriver} onClose={() => setModals({ ...modals, deleteDriver: false })} driver={selectedDriver} onDelete={() => handleDeleteDriver(selectedDriver?.id || "")} onReassign={() => setModals({ ...modals, deleteDriver: false })} />

      {/* Toast */}
      {toast && <Toast message={toast} />}
    </div>
  );
}

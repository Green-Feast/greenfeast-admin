"use client";

import { useState } from "react";
import { Loader2, Download, FileText } from "lucide-react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { cn } from "@/lib/utils";

/* ─── Data ───────────────────────────────────────────────────────────────────── */

const date = "21/5/26";

type Subscriber = {
  code: string;
  rc: "C" | "R";
  name: string;
  phone: string;
  address: string;
  meal: string;
  constraints: string;
  addons: string;
  timing: string;
  note?: string;
};

const subscribers: Subscriber[] = [
  // NAMI BATCH
  { code: "N/C/01", rc: "C", name: "Nitika Shilp Sangam", phone: "7610030677", address: "G-961 near balaji market sitapura ricco", meal: "Asian Bowl", constraints: "Extra Paneer", addons: "", timing: "" },
  { code: "N/C/02", rc: "C", name: "Aanchal", phone: "9782212557", address: "Jawahar Nagar", meal: "Asian Bowl", constraints: "No Buddha Avo protein Thai Or anything with tofu", addons: "", timing: "", note: "Try to send her panini or wrap once, Alternate" },
  { code: "N/C/03", rc: "C", name: "Hiya", phone: "9571660678", address: "JNU Jagatpura", meal: "Asian Bowl", constraints: "No peanut, No Pesto No mushroom", addons: "", timing: "" },
  { code: "N/C/04", rc: "C", name: "Dr. Nisha", phone: "8080475554", address: "Dermatalogy Department Mahatma Gandhi", meal: "Asian Bowl", constraints: "No Bell pepper no Mushroom no cilli tofu", addons: "", timing: "Before 1:00pm" },
  { code: "N/C/05", rc: "C", name: "Dr. Ishika Nanda", phone: "8171675992", address: "Dermatalogy Department Mahatma Gandhi", meal: "Asian Bowl", constraints: "No Bell pepper, extra Lettuce", addons: "", timing: "Before 1:00pm", note: "more panini" },
  { code: "N/C/06", rc: "C", name: "Jasleen", phone: "9815406442", address: "Skin opd basement, inside mahatma gandhi hospital jaipur", meal: "Asian Bowl", constraints: "No pasta add quinoa", addons: "", timing: "Before 1:00pm", note: "Only Tuesday to Friday" },
  { code: "N/C/07", rc: "C", name: "Dr. Muskan Jindal", phone: "9971414065", address: "Dermatalogy Department Mahatma Gandhi", meal: "Asian Bowl", constraints: "ALLERGIC TO QUINOA", addons: "", timing: "Before 1:00pm" },
  { code: "N/C/08", rc: "C", name: "Karan Dutt", phone: "8628072700", address: "Sector 17 Pratap Nagar", meal: "Asian Bowl", constraints: "use quinoa", addons: "Smoothies", timing: "", note: "Only Bowls, no panini/wrap" },
  { code: "N/C/09", rc: "C", name: "Dr. Gurusha Kausal", phone: "8955652679", address: "MGMC optha", meal: "Asian Bowl", constraints: "NO PANEER, Add tofu", addons: "", timing: "Before 1:00pm" },
  { code: "N/R/10", rc: "R", name: "Pallavi Bhadu", phone: "9782946260", address: "R-50, NRI colony, Pratap nagar, jaipur 302033", meal: "Asian Bowl", constraints: "", addons: "", timing: "Before 12:00pm" },
  { code: "N/R/11", rc: "R", name: "Shweta Khari", phone: "7290929167", address: "deliver in basement medical college mgh", meal: "Asian Bowl", constraints: "", addons: "", timing: "" },
  { code: "N/R/12", rc: "R", name: "Abhimanyu Sinha", phone: "9172220043", address: "203, MJB Athulyam 1 jagatpura Jaipur", meal: "Thai Gen", constraints: "Mexican, Soya panini, smoky chipotle", addons: "", timing: "" },
  { code: "N/R/13", rc: "R", name: "Nitika Sood", phone: "8094502015", address: "Sdc euro exotica flat no 411 Kaushal nagar sanganer", meal: "Asian Bowl", constraints: "", addons: "", timing: "" },
  { code: "N/R/14", rc: "R", name: "Roushan", phone: "7999651946", address: "Maharana pratap statue circle", meal: "Asian Bowl", constraints: "", addons: "", timing: "" },
  { code: "N/R/15", rc: "R", name: "Prakriti Jamne", phone: "7509751551", address: "E-301, 3rd Floor, AIS Residency, Pratap Nagar, Jaipur", meal: "Asian Bowl", constraints: "", addons: "", timing: "" },
  { code: "N/R/16", rc: "R", name: "Dr Sarah Chawla", phone: "7073777345", address: "MGMC optha", meal: "Asian Bowl", constraints: "", addons: "", timing: "" },

  // RAHUL BATCH
  { code: "R/C/01", rc: "C", name: "Ankit Chitlangiya", phone: "9829005037", address: "H1-64 RIICO INDUSTRIAL MANSAROVAR JAIPUR 302020", meal: "Asian Bowl", constraints: "Dressing Outside", addons: "Extra protein", timing: "Before 1:00pm" },
  { code: "R/C/02", rc: "C", name: "Deepanshu Sarda", phone: "9460102650", address: "196 basant bahar main tonk road gopalpura", meal: "Asian Bowl", constraints: "No Mushrooms, Gluten Free", addons: "Extra Protein", timing: "" },
  { code: "R/C/03", rc: "C", name: "Vandana Chandana", phone: "9829648888", address: "Sita Bari Near Theme Hotel", meal: "Asian Bowl", constraints: "GLUTEN FREE + 2 dressing 1 non spicy 1 spicy", addons: "", timing: "" },
  { code: "R/C/04", rc: "C", name: "Gunjan Khandelwal", phone: "9829993434", address: "702, The Legend, Near Hotel Marriot, Durgapura, Jaipur", meal: "Asian Bowl", constraints: "No Mushroom, No Tofu", addons: "", timing: "" },
  { code: "R/R/05", rc: "R", name: "Muskan Karnawat", phone: "9828899959", address: "92/8, Mahaveer nagar, Durgapura", meal: "Asian Bowl", constraints: "", addons: "", timing: "Before 1:00pm" },
  { code: "R/R/06", rc: "R", name: "Arvind Gupta", phone: "9829050571", address: "D9-A, D9-B, Lal Bahadur Nagar East, Sector 9, Malviya Nagar", meal: "Asian Bowl", constraints: "2 Meals", addons: "", timing: "Before 1:00pm" },
  { code: "R/R/07", rc: "R", name: "Siddharth Pruthi", phone: "9784017972", address: "SPP Atelier 55 & 55A parasram Nagar, patrakar colony road, golyawas mansarovar", meal: "Asian Bowl", constraints: "", addons: "", timing: "" },

  // YASHPAL BATCH
  { code: "Y/C/01", rc: "C", name: "Sonal Mendiratta", phone: "9829722323", address: "3ta38 ratan duggar marg jawahar nagar jaipur", meal: "Asian Bowl", constraints: "", addons: "EXTRA PROTEIN", timing: "" },
  { code: "Y/C/02", rc: "C", name: "Rahul Janani", phone: "9829160415", address: "Marvy Jewels, 2nd floor, Chaura Raasta, Jaipur", meal: "Asian Bowl", constraints: "No salt, no cheese, no butter, no feta", addons: "", timing: "" },
  { code: "Y/C/03", rc: "C", name: "Rohit Thawrani", phone: "9509508345", address: "Shop 39b old atish market MGD market jaipur", meal: "Asian Bowl", constraints: "No carbs, No Quinoa, No wraps", addons: "Extra protein", timing: "Before 1:30pm" },
  { code: "Y/C/04", rc: "C", name: "Pratyush Agarwal", phone: "9929407481", address: "102, Geeta Enclave, Vinobha Marg, C-scheme, Jaipur", meal: "Peri Peri Panini", constraints: "", addons: "Extra Protein", timing: "", note: "Thursdays: peri peri panini; ICE BLOCK" },
  { code: "Y/C/05", rc: "C", name: "Dr. Charul", phone: "9001024212", address: "Gandhi Path", meal: "Umami Soba Bowl", constraints: "No lettuce, add other veggies", addons: "", timing: "", note: "Quantity Issue" },
  { code: "Y/C/06", rc: "C", name: "Dr. Sanjana Somani", phone: "9873848847", address: "House 227 lane 7 guru jambeshwar nagar Vaishali nagar jaipur", meal: "Asian Bowl", constraints: "Less quinoa more panini", addons: "", timing: "" },
  { code: "Y/C/07", rc: "C", name: "Utsav Sharma", phone: "8302648202", address: "E-106, Shastri nagar near nagar Nigam office", meal: "Asian Bowl", constraints: "NO Quinoa", addons: "", timing: "Before 1:30pm" },
  { code: "Y/C/08", rc: "C", name: "Puru", phone: "8955708287", address: "A-29-B, Vivekanand Colony, Naya Khera", meal: "Asian Bowl", constraints: "NO mushroom", addons: "", timing: "" },
  { code: "Y/R/09", rc: "R", name: "Prasant", phone: "7023822610", address: "Gurunanak Pura Tilak nagar", meal: "Asian Bowl", constraints: "", addons: "", timing: "" },
  { code: "Y/R/10", rc: "R", name: "Raghav Agarwal", phone: "9782741432", address: "Agarwal & company, 1307, kedia bhawan, gopal ji ka rasta, johri bazar", meal: "Asian Bowl", constraints: "", addons: "", timing: "" },
  { code: "Y/R/11", rc: "R", name: "Dr. Gaurav", phone: "9929471752", address: "ExcelCare Hospital, 103, sanjay nagar, joshi marg, kalwar road, jhotwara", meal: "Asian Bowl", constraints: "", addons: "", timing: "", note: "tuesday off" },
  { code: "Y/R/12", rc: "R", name: "Arihant Dhadda", phone: "9828018090", address: "Kalki showroom near teenmurti circle", meal: "Umami Soba Bowl", constraints: "", addons: "", timing: "" },

  // SANTU BATCH
  { code: "S/C/01", rc: "C", name: "Aditii Sisodiya", phone: "9820415361", address: "SMS stadium / Holiday Inn", meal: "Asian Bowl", constraints: "Less carbs, more veggies, no beetroot, no chickpeas, no tofu", addons: "", timing: "Around 8:00pm", note: "Meal yet to be confirmed" },
  { code: "S/C/02", rc: "C", name: "Dr. Shivam", phone: "9992787315", address: "Jain Ent Hospital Lal Kothi", meal: "Asian Bowl", constraints: "No Papaya, No corn", addons: "", timing: "" },
  { code: "S/C/03", rc: "C", name: "Dr. Sidhant", phone: "8225000777", address: "", meal: "Asian Bowl", constraints: "Gluten Free", addons: "", timing: "" },
  { code: "S/C/04", rc: "C", name: "Dr. Ashray Jain", phone: "6387668569", address: "Jain Ent Hospital Lal Kothi", meal: "Tropical Fruit Salad", constraints: "", addons: "Extra spicy smoothie", timing: "", note: "Thursday - tropical fruit + smoothie" },
  { code: "S/C/05", rc: "C", name: "Anant", phone: "8619957997", address: "Ruby 302, Somdatt Apartments, Civil Lines, Hawa Sadak, Jaipur", meal: "Mexican Fiesta Bowl", constraints: "More dressing", addons: "", timing: "" },
  { code: "S/C/06", rc: "C", name: "Surabhi Pannu", phone: "9636456512", address: "Bhandari House Govindpuri c-38 hawa sadak jaipur", meal: "Asian Bowl", constraints: "DAIRY FREE ALLERGEN", addons: "", timing: "Before 12:00pm" },
  { code: "S/C/07", rc: "C", name: "Ashwin Ji", phone: "7021139318", address: "Shop 47, Gangaram Nagar, New Aatish Market, Shanthi Nagar", meal: "Asian Bowl", constraints: "Less Carbs, No tofu, No Quinoa budha", addons: "Extra protein", timing: "" },
  { code: "S/C/08", rc: "C", name: "Akash Chauhan", phone: "8233186472", address: "256, Vardhman Nagar-A, Ajmer Road, Jaipur 302019", meal: "Asian Bowl", constraints: "No Pasta, No Mushroom, No Noodles", addons: "", timing: "" },
  { code: "S/C/09", rc: "C", name: "Giri Raj", phone: "7568387373", address: "4/487, near sethi departmental store, jawarhar nagar", meal: "Asian Bowl", constraints: "Extra Paneer, Extra Corn", addons: "Avo Protein", timing: "" },
  { code: "S/R/10", rc: "R", name: "Bharti Maheshwari", phone: "8742067974", address: "Partani Clinic 175 no gali no 7 barkat nagar 302015", meal: "Asian Bowl", constraints: "", addons: "", timing: "" },
  { code: "S/R/11", rc: "R", name: "Dr. Sudhanshu", phone: "7415010737", address: "AMRC Park Hospital Kiran Path", meal: "Asian Bowl", constraints: "", addons: "", timing: "Before 1:15pm" },
  { code: "S/R/12", rc: "R", name: "Rishabh Rao", phone: "7976287022", address: "C216/g1, ss apartment, nirman nagar", meal: "Panini", constraints: "", addons: "", timing: "" },

  // EVENING BATCH
  { code: "E/C/01", rc: "C", name: "Praveen Vijayvegiya", phone: "9982613131", address: "1st floor, g9, jalsa building, green street, lal bahdur nagar, jln marg", meal: "Asian Bowl", constraints: "EXTRA Protein", addons: "", timing: "Before 1:30pm" },
  { code: "E/C/02", rc: "C", name: "Shubham Gangwal", phone: "9597445822", address: "K-19, K Block Mahaveer Nagar, Tonk Road, Jaipur-302018", meal: "Asian Bowl", constraints: "NO AVOCADO", addons: "2 Egg and 100gm Tofu (alternating days)", timing: "" },
  { code: "E/C/03", rc: "C", name: "Shivani Puri", phone: "9982511715", address: "K-29, Trinity Kartikeya, Mahaveer Nagar, Durga Pura", meal: "Asian Bowl", constraints: "Chipotle dressing + Peanut dressing, No avo protein", addons: "EXTRA PROTEIN", timing: "", note: "Give at end" },
  { code: "E/C/04", rc: "C", name: "Aman Dua", phone: "7597092777", address: "1-GHA-9, Jawahar Nagar, Sector-1, behind bank of baroda", meal: "Quinoa Buddha Bowl", constraints: "No beetroot, No sweet potato, add 100gm paneer", addons: "2 Meals", timing: "" },
  { code: "E/R/05", rc: "R", name: "Mukesh Rela", phone: "9829066110", address: "new address", meal: "Asian Bowl", constraints: "", addons: "", timing: "" },
  { code: "E/R/06", rc: "R", name: "Harshit Sachdeva", phone: "9660612829", address: "Behind LBS College house 75 Shanti Path Tilak nagar", meal: "Asian Bowl", constraints: "", addons: "", timing: "" },
];

const batches = ["Nami", "Rahul", "Yashpal", "Santu", "Evening"];

const batchDrivers: Record<string, string> = {
  Nami: "Nami Driver",
  Rahul: "Rahul Driver",
  Yashpal: "Yashpal Driver",
  Santu: "Santu Driver",
  Evening: "Evening Driver",
};

const batchColors: Record<string, { light: [number, number, number]; dark: [number, number, number] }> = {
  Nami:    { light: [200, 220, 245], dark: [30, 144, 255] },
  Rahul:   { light: [220, 195, 245], dark: [100, 50, 200] },
  Yashpal: { light: [255, 220, 180], dark: [255, 140, 0] },
  Santu:   { light: [255, 200, 220], dark: [220, 20, 60] },
  Evening: { light: [255, 235, 180], dark: [255, 165, 0] },
};

/* ─── Helpers ───────────────────────────────────────────────────────────────── */

function getBatchSubscribers(batch: string) {
  return subscribers.filter((s) => s.code[0] === batch[0].toUpperCase());
}

function countMeals(subs: Subscriber[]) {
  const counts: Record<string, number> = {};
  subs.forEach((s) => {
    counts[s.meal] = (counts[s.meal] || 0) + 1;
  });
  return counts;
}

function mealCountsText(counts: Record<string, number>) {
  return Object.entries(counts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([meal, count]) => `${meal}: ${count}`)
    .join(" | ");
}

/* ─── PDF Generators ────────────────────────────────────────────────────────── */

function generateMasterListPDF(subs: Subscriber[]) {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  let pageNum = 1;

  function addHeader() {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.text("GreenFeast", 10, 8);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text("MASTER LIST", pageWidth / 2, 14, { align: "center" });

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text(`Date: ${date}`, pageWidth - 20, 8, { align: "right" });
    doc.text(`Page ${pageNum} of ?`, pageWidth - 20, 14, { align: "right" });
  }

  function addFooter(allCounts: Record<string, number>) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text("Items to Prepare (Grand Total):", 10, pageHeight - 8);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.text(mealCountsText(allCounts), 10, pageHeight - 4);
  }

  // Group by batch and add table
  let currentY = 22;
  let allMealCounts: Record<string, number> = {};

  batches.forEach((batch) => {
    const batchSubs = subs.filter((s) => s.code[0] === batch[0].toUpperCase());
    if (batchSubs.length === 0) return;

    // Batch header row
    if (currentY > pageHeight - 40) {
      addFooter(allMealCounts);
      doc.addPage();
      pageNum++;
      currentY = 22;
      addHeader();
    }

    doc.setFillColor(...batchColors[batch].light);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.rect(10, currentY - 3, pageWidth - 20, 6, "F");
    doc.text(batch, 12, currentY + 0.5);
    currentY += 8;

    // Table data
    const tableData = batchSubs.map((s) => [
      s.code,
      s.rc,
      s.name,
      s.phone,
      s.address.substring(0, 30),
      s.meal,
      s.constraints.substring(0, 25),
      s.addons,
      s.timing,
      s.note || "",
    ]);

    autoTable(doc, {
      startY: currentY,
      head: [["Code", "R/C", "Name", "Phone", "Address", "Meal", "Constraints", "Add-ons", "Timing", "Note"]],
      body: tableData,
      columnStyles: {
        0: { cellWidth: 12 },
        1: { cellWidth: 8 },
        2: { cellWidth: 20 },
        3: { cellWidth: 16 },
        4: { cellWidth: 32 },
        5: { cellWidth: 18 },
        6: { cellWidth: 25 },
        7: { cellWidth: 12 },
        8: { cellWidth: 14 },
        9: { cellWidth: 15 },
      },
      headStyles: { fillColor: [27, 94, 32], textColor: [255, 255, 255], fontSize: 8, fontStyle: "bold" },
      bodyStyles: { fontSize: 7 },
      alternateRowStyles: { fillColor: [249, 251, 247] },
      margin: { top: currentY, bottom: 15 },
      didDrawPage: () => {},
    });

    currentY = (doc as any).lastAutoTable.finalY + 4;

    // Count meals
    const batchCounts = countMeals(batchSubs);
    Object.entries(batchCounts).forEach(([meal, count]) => {
      allMealCounts[meal] = (allMealCounts[meal] || 0) + count;
    });
  });

  addFooter(allMealCounts);
  doc.save(`GreenFeast-Master-List-${date.replace(/\//g, "-")}.pdf`);
}

function generateKitchenSheetPDF() {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  // Header
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.text("GreenFeast", 10, 8);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text("Kitchen Sheet", pageWidth / 2, 14, { align: "center" });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(`Date: ${date}`, pageWidth - 15, 8, { align: "right" });

  let currentY = 22;
  let allMealCounts: Record<string, number> = {};

  // Process each batch
  batches.forEach((batch) => {
    const batchSubs = subscribers.filter((s) => s.code[0] === batch[0].toUpperCase());
    if (batchSubs.length === 0) return;

    // Batch section header
    if (currentY > pageHeight - 50) {
      doc.addPage();
      currentY = 15;
    }

    doc.setFillColor(...batchColors[batch].light);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.rect(10, currentY - 3, pageWidth - 20, 6, "F");
    doc.text(batch, 12, currentY + 0.5);
    currentY += 8;

    // Table for this batch
    const tableData = batchSubs.map((s) => [
      s.code,
      s.rc,
      s.name,
      s.meal,
      s.constraints,
      s.addons,
    ]);

    autoTable(doc, {
      startY: currentY,
      head: [["Code", "R/C", "Name", "Meal", "Constraints", "Add-ons"]],
      body: tableData,
      columnStyles: {
        0: { cellWidth: 15 },
        1: { cellWidth: 10 },
        2: { cellWidth: 40 },
        3: { cellWidth: 30 },
        4: { cellWidth: 50 },
        5: { cellWidth: 20 },
      },
      headStyles: { fillColor: [27, 94, 32], textColor: [255, 255, 255], fontSize: 8, fontStyle: "bold" },
      bodyStyles: { fontSize: 7 },
      alternateRowStyles: { fillColor: [249, 251, 247] },
      margin: { bottom: 4 },
      didDrawPage: () => {},
    });

    currentY = (doc as any).lastAutoTable.finalY + 2;

    // Batch subtotal footer
    const batchCounts = countMeals(batchSubs);
    const batchSubtotal = mealCountsText(batchCounts);

    if (currentY > pageHeight - 15) {
      doc.addPage();
      currentY = 15;
    }

    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.text(`${batch} — Items to Prepare:`, 12, currentY);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.text(batchSubtotal, 12, currentY + 4);

    currentY += 8;

    // Accumulate totals
    Object.entries(batchCounts).forEach(([meal, count]) => {
      allMealCounts[meal] = (allMealCounts[meal] || 0) + count;
    });
  });

  // Grand total footer at the end
  if (currentY > pageHeight - 15) {
    doc.addPage();
    currentY = 15;
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text("Items to Prepare (Grand Total):", 10, currentY + 3);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.text(mealCountsText(allMealCounts), 10, currentY + 8);

  doc.save(`GreenFeast-Kitchen-${date.replace(/\//g, "-")}.pdf`);
}

function generateDeliverySheetPDF(batch: string, subs: Subscriber[]) {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();

  // Header
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.text("GreenFeast", 10, 8);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text(`${batch} — Delivery`, pageWidth / 2, 14, { align: "center" });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(`Date: ${date}`, pageWidth - 15, 8, { align: "right" });

  // Table
  const tableData = subs.map((s) => [
    s.code,
    s.name,
    s.phone,
    s.address,
    s.timing,
  ]);

  autoTable(doc, {
    startY: 22,
    head: [["Code", "Name", "Phone", "Address", "Timing"]],
    body: tableData,
    columnStyles: {
      0: { cellWidth: 15 },
      1: { cellWidth: 35 },
      2: { cellWidth: 25 },
      3: { cellWidth: 60 },
      4: { cellWidth: 20 },
    },
    headStyles: { fillColor: [27, 94, 32], textColor: [255, 255, 255], fontSize: 9, fontStyle: "bold" },
    bodyStyles: { fontSize: 8 },
    alternateRowStyles: { fillColor: [249, 251, 247] },
    margin: { bottom: 15 },
  });

  doc.save(`GreenFeast-${batch}-Delivery-${date.replace(/\//g, "-")}.pdf`);
}

/* ─── Components ────────────────────────────────────────────────────────────── */

function Toast({ message }: { message: string }) {
  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-green-600 text-white text-sm px-4 py-2.5 rounded-lg shadow-lg animate-in fade-in slide-in-from-bottom-2 duration-200">
      ✓ {message}
    </div>
  );
}

type LoadingState = {
  all: boolean;
  kitchen: Record<string, boolean> & { standalone?: boolean };
  delivery: Record<string, boolean>;
};

export function OperationsClient() {
  const [loading, setLoading] = useState<LoadingState>({
    all: false,
    kitchen: {},
    delivery: {},
  });
  const [toast, setToast] = useState("");

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(""), 3000);
  }

  async function handleGenerateAll() {
    setLoading((l) => ({ ...l, all: true }));

    // Generate all PDFs with small delays: Master List + Kitchen Sheet + 5 Delivery Sheets
    try {
      generateMasterListPDF(subscribers);
      await new Promise((r) => setTimeout(r, 300));

      generateKitchenSheetPDF();
      await new Promise((r) => setTimeout(r, 300));

      for (const batch of batches) {
        const batchSubs = getBatchSubscribers(batch);
        generateDeliverySheetPDF(batch, batchSubs);
        await new Promise((r) => setTimeout(r, 300));
      }

      showToast("Sheets generated successfully");
    } finally {
      setLoading((l) => ({ ...l, all: false }));
    }
  }

  async function handleGenerateKitchen() {
    setLoading((l) => ({ ...l, kitchen: { ...l.kitchen, standalone: true } }));

    try {
      generateKitchenSheetPDF();
      showToast("Kitchen sheet generated");
    } finally {
      setLoading((l) => ({ ...l, kitchen: { ...l.kitchen, standalone: false } }));
    }
  }


  async function handleGenerateDelivery(batch: string) {
    setLoading((l) => ({
      ...l,
      delivery: { ...l.delivery, [batch]: true },
    }));

    try {
      const batchSubs = getBatchSubscribers(batch);
      generateDeliverySheetPDF(batch, batchSubs);
      showToast(`${batch} delivery sheet generated`);
    } finally {
      setLoading((l) => ({
        ...l,
        delivery: { ...l.delivery, [batch]: false },
      }));
    }
  }

  const totalDeliveries = subscribers.length;

  return (
    <div className="p-6 max-w-[1200px] mx-auto">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-[#1A1A1A] tracking-tight">Operations</h1>
        <p className="text-sm text-gray-500 mt-0.5">Daily sheet generation — Thursday, 21 May 2026</p>
        <p className="text-xs text-gray-400 mt-2">Last generated: Today at 8:00 AM</p>
      </div>

      {/* Generate All card */}
      <div className="bg-gradient-to-r from-[#1B5E20] to-[#2E7D32] text-white rounded-2xl p-8 mb-8 shadow-lg">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-xl font-bold mb-2">Generate All Sheets</h2>
            <p className="text-white/80 text-sm mb-4">5 batches · {totalDeliveries} deliveries · 3 sheet types</p>
            <p className="text-xs text-white/60">1 Master List · 1 Kitchen Sheet · 5 Delivery Sheets</p>
          </div>
          <div className="flex gap-3 flex-wrap flex-shrink-0">
            <button
              onClick={handleGenerateKitchen}
              disabled={loading.kitchen.standalone}
              className="flex items-center gap-2 px-5 py-3 rounded-lg bg-white/20 text-white font-semibold hover:bg-white/30 disabled:opacity-50 disabled:cursor-not-allowed transition-all border border-white/30"
            >
              {loading.kitchen.standalone ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Kitchen...
                </>
              ) : (
                <>
                  <FileText className="w-4 h-4" />
                  Kitchen Sheet
                </>
              )}
            </button>
            <button
              onClick={handleGenerateAll}
              disabled={loading.all}
              className="flex items-center gap-2 px-6 py-3 rounded-lg bg-[#FDD835] text-[#1A1A1A] font-semibold hover:bg-yellow-400 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              {loading.all ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Download className="w-4 h-4" />
                  Generate All
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Batch cards grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {batches.map((batch) => {
          const batchSubs = getBatchSubscribers(batch);
          return (
            <div key={batch} className="bg-white rounded-xl border border-[#e2e8d5] shadow-sm overflow-hidden hover:shadow-md transition-shadow">
              {/* Batch header */}
              <div
                className="px-5 py-4 border-b border-[#e2e8d5]"
                style={{
                  backgroundColor: `rgb(${batchColors[batch].light.join(",")})`,
                }}
              >
                <h3 className="text-lg font-bold text-[#1A1A1A]">{batch}</h3>
                <p className="text-xs text-gray-600 mt-1">{batchDrivers[batch]}</p>
                <p className="text-sm font-semibold text-[#1B5E20] mt-2">{batchSubs.length} deliveries</p>
              </div>

              {/* Buttons */}
              <div className="p-4 space-y-2.5">
                <button
                  onClick={() => handleGenerateDelivery(batch)}
                  disabled={loading.delivery[batch]}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border border-[#1B5E20] bg-white text-[#1B5E20] font-medium hover:bg-green-50 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                >
                  {loading.delivery[batch] ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Delivery...
                    </>
                  ) : (
                    <>
                      <FileText className="w-3.5 h-3.5" />
                      Delivery Sheet
                    </>
                  )}
                </button>

                <p className="text-xs text-gray-400 text-center mt-2 py-2 border-t border-[#e2e8d5]">
                  Master List & Kitchen Sheet available in "Generate All"
                </p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Toast */}
      {toast && <Toast message={toast} />}
    </div>
  );
}

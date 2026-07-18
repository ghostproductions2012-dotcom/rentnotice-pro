export interface StateCoverage {
  code: string;
  name: string;
  payOrQuitDays: number;
  periodLabel: string;
  citation: string;
  terminationNote: string;
  attorneyReviewed: boolean;
}

function entry(
  code: string,
  name: string,
  payOrQuitDays: number,
  citation: string,
  terminationNote: string,
  attorneyReviewed = false,
): StateCoverage {
  return {
    code,
    name,
    payOrQuitDays,
    periodLabel:
      payOrQuitDays === 0
        ? "Set by state law"
        : `${payOrQuitDays}-day pay-or-quit`,
    citation,
    terminationNote,
    attorneyReviewed,
  };
}

export const STATE_COVERAGE: StateCoverage[] = [
  entry("AL", "Alabama", 7, "Ala. Code §35-9A-421.", "Termination: 30 days month-to-month."),
  entry("AK", "Alaska", 7, "Alaska Stat. §34.03.220.", "Termination: 30 days month-to-month."),
  entry("AZ", "Arizona", 5, "Ariz. Rev. Stat. §33-1368.", "Termination: 30 days month-to-month."),
  entry("AR", "Arkansas", 3, "Ark. Code §18-17-701.", "Termination: 30 days (10 days week-to-week)."),
  {
    code: "CA",
    name: "California",
    payOrQuitDays: 3,
    periodLabel: "3 court days pay-or-quit",
    citation: "Cal. Code Civ. Proc. §1161(2) (excludes weekends & judicial holidays).",
    terminationNote: "Attorney-reviewed statutory templates, including cure-or-quit (CCP §1161(3)), with a maintained California court holiday calendar.",
    attorneyReviewed: true,
  },
  entry("CO", "Colorado", 10, "Colo. Rev. Stat. §13-40-104.", "Termination: 21-91 days by tenancy length."),
  entry("CT", "Connecticut", 3, "Conn. Gen. Stat. §47a-23.", "Termination: 3 days' notice to quit."),
  entry("DE", "Delaware", 5, "Del. Code tit. 25 §5502.", "Termination: 60 days month-to-month."),
  entry("DC", "District of Columbia", 30, "D.C. Code §42-3505.01.", "Cause-based; 30-day cure for nonpayment; 30-90 days termination."),
  entry("FL", "Florida", 3, "Fla. Stat. §83.56(3) (excludes weekends/holidays).", "Termination: 30 days month-to-month."),
  entry("GA", "Georgia", 0, "Ga. Code §44-7-50 (demand for possession).", "No statutory cure period; 60 days landlord termination."),
  entry("HI", "Hawaii", 5, "Haw. Rev. Stat. §521-68.", "Termination: 45 days (landlord) month-to-month."),
  entry("ID", "Idaho", 3, "Idaho Code §6-303.", "Termination: 30 days month-to-month."),
  entry("IL", "Illinois", 5, "735 ILCS 5/9-209.", "Termination: 30 days month-to-month."),
  entry("IN", "Indiana", 10, "Ind. Code §32-31-1-6.", "Termination: 30 days month-to-month."),
  entry("IA", "Iowa", 3, "Iowa Code §562A.27.", "Termination: 30 days month-to-month."),
  entry("KS", "Kansas", 3, "Kan. Stat. §58-2564.", "Termination: 30 days month-to-month."),
  entry("KY", "Kentucky", 7, "Ky. Rev. Stat. §383.660 (URLTA counties).", "Termination: 30 days month-to-month."),
  entry("LA", "Louisiana", 5, "La. Code Civ. Proc. art. 4701.", "Termination: 10 days month-to-month."),
  entry("ME", "Maine", 7, "Me. Rev. Stat. tit. 14 §6002.", "Termination: 30 days month-to-month."),
  entry("MD", "Maryland", 10, "Md. Real Prop. §8-401.", "Termination: 60 days month-to-month."),
  entry("MA", "Massachusetts", 14, "Mass. Gen. Laws ch. 186 §11.", "Termination: rental-period notice (>=30 days)."),
  entry("MI", "Michigan", 7, "Mich. Comp. Laws §554.134.", "Termination: 30 days month-to-month."),
  entry("MN", "Minnesota", 14, "Minn. Stat. §504B.135, §504B.291.", "Termination: rental-period notice."),
  entry("MS", "Mississippi", 3, "Miss. Code §89-8-13.", "Termination: 30 days month-to-month."),
  entry("MO", "Missouri", 0, "Mo. Rev. Stat. §535.010 (immediate demand).", "Termination: 30 days (one rental period)."),
  entry("MT", "Montana", 3, "Mont. Code §70-24-422.", "Termination: 30 days month-to-month."),
  entry("NE", "Nebraska", 7, "Neb. Rev. Stat. §76-1431.", "Termination: 30 days month-to-month."),
  entry("NV", "Nevada", 7, "Nev. Rev. Stat. §40.253 (excludes weekends/holidays).", "Termination: 30 days month-to-month."),
  entry("NH", "New Hampshire", 7, "N.H. Rev. Stat. §540:3, §540:9.", "Termination: 30 days for cause."),
  entry("NJ", "New Jersey", 0, "N.J. Stat. §2A:18-61.1 et seq. (Anti-Eviction Act).", "No cure period for nonpayment; cause-based termination."),
  entry("NM", "New Mexico", 3, "N.M. Stat. §47-8-33.", "Termination: 30 days month-to-month."),
  entry("NY", "New York", 14, "N.Y. Real Prop. Acts Law §711.", "Termination: 30-90 days by occupancy length."),
  entry("NC", "North Carolina", 10, "N.C. Gen. Stat. §42-3.", "Termination: 7 days month-to-month."),
  entry("ND", "North Dakota", 3, "N.D. Cent. Code §47-32-01.", "Termination: 30 days month-to-month."),
  entry("OH", "Ohio", 3, "Ohio Rev. Code §1923.04, §5321.17.", "Termination: 30 days month-to-month."),
  entry("OK", "Oklahoma", 5, "Okla. Stat. tit. 41 §131.", "Termination: 30 days month-to-month."),
  entry("OR", "Oregon", 3, "Or. Rev. Stat. §90.394 (72-hour / 144-hour).", "Termination: 30-90 days (just cause)."),
  entry("PA", "Pennsylvania", 10, "68 Pa. Stat. §250.501.", "Termination: 15-30 days by lease length."),
  entry("RI", "Rhode Island", 5, "R.I. Gen. Laws §34-18-35.", "Termination: 30 days month-to-month."),
  entry("SC", "South Carolina", 5, "S.C. Code §27-40-710.", "Termination: 30 days month-to-month."),
  entry("SD", "South Dakota", 3, "S.D. Codified Laws §21-16-2.", "Termination: 30 days month-to-month."),
  entry("TN", "Tennessee", 14, "Tenn. Code §66-28-505 (URLTA counties).", "Termination: 30 days month-to-month."),
  entry("TX", "Texas", 3, "Tex. Prop. Code §24.005.", "Notice to vacate; lease may modify the period."),
  entry("UT", "Utah", 3, "Utah Code §78B-6-802.", "Termination: 15 days month-to-month."),
  entry("VT", "Vermont", 14, "Vt. Stat. tit. 9 §4467.", "Termination: 60-90 days by occupancy length."),
  entry("VA", "Virginia", 5, "Va. Code §55.1-1245.", "Termination: 30 days month-to-month."),
  entry("WA", "Washington", 14, "Wash. Rev. Code §59.12.030(3).", "Termination: 20 days month-to-month (just cause)."),
  entry("WV", "West Virginia", 0, "W. Va. Code §55-3A-1 (no cure period).", "Termination: one rental period notice."),
  entry("WI", "Wisconsin", 5, "Wis. Stat. §704.17.", "Termination: 28 days month-to-month."),
  entry("WY", "Wyoming", 3, "Wyo. Stat. §1-21-1002 to 1003.", "Termination: reasonable notice (commonly 30 days)."),
];

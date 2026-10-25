// Player pools for every auction mode.
// Each entry is "Name/ROLE" (Indian) or "Name/ROLE/COUNTRY" (overseas). ROLE: BAT, WK, AR, BOWL.
// Base prices are in lakhs (200 = ₹2 cr) and are game settings, not official IPL values.

const parse = (base, list) => list.map(s => {
  const [name, role, country = 'IND'] = s.split('/');
  return { name, role, country, base };
});

// ---------- current IPL players (auction pool) ----------
const CURRENT = [
  ...parse(200, [
    "Virat Kohli/BAT", "Rohit Sharma/BAT", "MS Dhoni/WK", "Jasprit Bumrah/BOWL", "Shubman Gill/BAT",
    "Rishabh Pant/WK", "Suryakumar Yadav/BAT", "Hardik Pandya/AR", "Ravindra Jadeja/AR", "KL Rahul/WK",
    "Shreyas Iyer/BAT", "Yashasvi Jaiswal/BAT", "Mohammed Shami/BOWL", "Arshdeep Singh/BOWL", "Yuzvendra Chahal/BOWL",
    "Sanju Samson/WK", "Abhishek Sharma/AR", "Rinku Singh/BAT", "Axar Patel/AR", "Kuldeep Yadav/BOWL",
    "Mohammed Siraj/BOWL", "Ishan Kishan/WK", "Ruturaj Gaikwad/BAT", "Tilak Varma/BAT", "Varun Chakravarthy/BOWL",
    "Pat Cummins/BOWL/AUS", "Mitchell Starc/BOWL/AUS", "Travis Head/BAT/AUS", "Jos Buttler/WK/ENG", "Rashid Khan/BOWL/AFG",
    "Heinrich Klaasen/WK/SA", "Kagiso Rabada/BOWL/SA", "Glenn Maxwell/AR/AUS", "Nicholas Pooran/WK/WI", "Sunil Narine/AR/WI",
    "Andre Russell/AR/WI", "Cameron Green/AR/AUS", "Phil Salt/WK/ENG", "Josh Hazlewood/BOWL/AUS", "Trent Boult/BOWL/NZ",
    "Jofra Archer/BOWL/ENG", "Liam Livingstone/AR/ENG"
  ]),
  ...parse(150, [
    "Bhuvneshwar Kumar/BOWL", "Washington Sundar/AR", "Shivam Dube/AR", "Ravichandran Ashwin/BOWL", "Prasidh Krishna/BOWL",
    "Harshal Patel/BOWL", "Venkatesh Iyer/AR", "Deepak Chahar/BOWL", "Riyan Parag/AR", "Dhruv Jurel/WK",
    "Nitish Kumar Reddy/AR", "Sai Sudharsan/BAT", "Rajat Patidar/BAT", "Jitesh Sharma/WK", "Ravi Bishnoi/BOWL",
    "Mayank Yadav/BOWL", "Avesh Khan/BOWL", "Krunal Pandya/AR",
    "Marcus Stoinis/AR/AUS", "David Miller/BAT/SA", "Quinton de Kock/WK/SA", "Rachin Ravindra/AR/NZ", "Aiden Markram/BAT/SA",
    "Mitchell Marsh/AR/AUS", "Tim David/BAT/AUS", "Sam Curran/AR/ENG", "Will Jacks/AR/ENG", "Marco Jansen/AR/SA",
    "Tristan Stubbs/WK/SA", "Matheesha Pathirana/BOWL/SL", "Wanindu Hasaranga/AR/SL", "Noor Ahmad/BOWL/AFG", "Lockie Ferguson/BOWL/NZ",
    "Anrich Nortje/BOWL/SA", "Devon Conway/BAT/NZ", "Jake Fraser-McGurk/BAT/AUS", "Josh Inglis/WK/AUS", "Faf du Plessis/BAT/SA",
    "Shimron Hetmyer/BAT/WI", "Glenn Phillips/AR/NZ", "Ryan Rickelton/WK/SA", "Mitchell Santner/AR/NZ", "Adam Zampa/BOWL/AUS",
    "Gerald Coetzee/BOWL/SA", "Dewald Brevis/BAT/SA", "David Warner/BAT/AUS", "Kane Williamson/BAT/NZ"
  ]),
  ...parse(100, [
    "Shardul Thakur/AR", "T Natarajan/BOWL", "Khaleel Ahmed/BOWL", "Mukesh Kumar/BOWL", "Harshit Rana/BOWL",
    "Sandeep Sharma/BOWL", "Tushar Deshpande/BOWL", "Yash Dayal/BOWL", "Ajinkya Rahane/BAT", "Devdutt Padikkal/BAT",
    "Shashank Singh/BAT", "Rahul Tewatia/AR", "Shahrukh Khan/BAT", "Ayush Badoni/BAT", "Abdul Samad/BAT",
    "Abishek Porel/WK", "Prabhsimran Singh/WK", "Angkrish Raghuvanshi/BAT", "Ramandeep Singh/AR", "Rahul Tripathi/BAT",
    "Nitish Rana/BAT", "Karun Nair/BAT", "Mohit Sharma/BOWL", "Akash Deep/BOWL", "Mohsin Khan/BOWL",
    "Umran Malik/BOWL", "Rahul Chahar/BOWL", "Ishant Sharma/BOWL", "Jaydev Unadkat/BOWL", "Manish Pandey/BAT",
    "Deepak Hooda/AR", "Vijay Shankar/AR", "Mayank Agarwal/BAT", "Prithvi Shaw/BAT", "Umesh Yadav/BOWL",
    "Sai Kishore/BOWL", "Naman Dhir/AR",
    "Maheesh Theekshana/BOWL/SL", "Rovman Powell/BAT/WI", "Azmatullah Omarzai/AR/AFG", "Romario Shepherd/AR/WI", "Nathan Ellis/BOWL/AUS",
    "Spencer Johnson/BOWL/AUS", "Alzarri Joseph/BOWL/WI", "Fazalhaq Farooqi/BOWL/AFG", "Dushmantha Chameera/BOWL/SL", "Mustafizur Rahman/BOWL/BAN",
    "Rahmanullah Gurbaz/WK/AFG", "Jonny Bairstow/WK/ENG", "Daryl Mitchell/AR/NZ", "Moeen Ali/AR/ENG", "Brydon Carse/AR/ENG",
    "Kamindu Mendis/AR/SL", "Jamie Overton/AR/ENG", "Jacob Bethell/AR/ENG", "Lungi Ngidi/BOWL/SA", "Shamar Joseph/BOWL/WI",
    "Sherfane Rutherford/BAT/WI", "Kusal Mendis/WK/SL", "Allah Ghazanfar/BOWL/AFG", "Steve Smith/BAT/AUS", "Kyle Jamieson/BOWL/NZ"
  ]),
  ...parse(75, [
    "Vaibhav Arora/BOWL", "Mayank Markande/BOWL", "Karn Sharma/BOWL", "Kumar Kartikeya/BOWL", "Akash Madhwal/BOWL",
    "Suyash Sharma/BOWL", "Rasikh Dar/BOWL", "Harpreet Brar/AR", "Shahbaz Ahmed/AR", "Mahipal Lomror/BAT",
    "Kumar Kushagra/WK", "Anuj Rawat/WK", "Jayant Yadav/AR", "Vijaykumar Vyshak/BOWL", "Yash Thakur/BOWL",
    "Kuldeep Sen/BOWL", "Chetan Sakariya/BOWL", "Kartik Tyagi/BOWL", "Nehal Wadhera/BAT", "Arjun Tendulkar/AR",
    "Reece Topley/BOWL/ENG", "Corbin Bosch/AR/SA", "Xavier Bartlett/BOWL/AUS", "Aaron Hardie/AR/AUS", "Matthew Breetzke/BAT/SA",
    "Donovan Ferreira/WK/SA", "Will O'Rourke/BOWL/NZ", "Tim Seifert/WK/NZ", "Mujeeb Ur Rahman/BOWL/AFG", "Nuwan Thushara/BOWL/SL",
    "Kwena Maphaka/BOWL/SA", "Nandre Burger/BOWL/SA", "Mitchell Owen/AR/AUS", "Wiaan Mulder/AR/SA", "Rilee Rossouw/BAT/SA",
    "Karim Janat/AR/AFG", "Charith Asalanka/BAT/SL", "Sediqullah Atal/BAT/AFG", "Eshan Malinga/BOWL/SL", "Lizaad Williams/BOWL/SA",
    "Richard Gleeson/BOWL/ENG", "Blessing Muzarabani/BOWL/ZIM", "Lhuan-dre Pretorius/WK/SA", "Bevon Jacobs/BAT/NZ"
  ]),
  ...parse(50, [
    "Manav Suthar/BOWL", "Simarjeet Singh/BOWL", "Anukul Roy/AR", "Mukesh Choudhary/BOWL", "Shreyas Gopal/BOWL",
    "Kamlesh Nagarkoti/AR", "Himmat Singh/BAT", "Atharva Taide/BAT", "Abhinav Manohar/BAT", "Darshan Nalkande/AR",
    "Rajvardhan Hangargekar/AR", "Shams Mulani/AR", "Swapnil Singh/AR", "Gurnoor Brar/BOWL", "M Siddharth/BOWL",
    "Sachin Baby/BAT", "Raj Angad Bawa/AR", "Arshad Khan/AR", "Kulwant Khejroliya/BOWL"
  ]),
  ...parse(30, [
    "Ashutosh Sharma/BAT", "Sameer Rizvi/BAT", "Priyansh Arya/BAT", "Vaibhav Suryavanshi/BAT", "Ayush Mhatre/BAT",
    "Aniket Verma/BAT", "Shaik Rasheed/BAT", "Andre Siddarth/BAT", "Swastik Chikara/BAT", "Shubham Dubey/BAT",
    "Pyla Avinash/BAT", "Harnoor Pannu/BAT", "Robin Minz/WK", "Urvil Patel/WK", "Aryan Juyal/WK",
    "Vansh Bedi/WK", "Luvnith Sisodia/WK", "Kunal Singh Rathore/WK", "Krishnan Shrijith/WK", "Anshul Kamboj/AR",
    "Vipraj Nigam/AR", "Musheer Khan/AR", "Suryansh Shedge/AR", "Nishant Sindhu/AR", "Manoj Bhandage/AR",
    "Yudhvir Singh/AR", "Ramakrishna Ghosh/AR", "Ajay Mandal/AR", "Madhav Tiwari/AR", "Tripurana Vijay/AR",
    "Manvanth Kumar/AR", "Yuvraj Chaudhary/AR", "Arshin Kulkarni/AR", "Ashwani Kumar/BOWL", "Vignesh Puthur/BOWL",
    "Digvesh Rathi/BOWL", "Prince Yadav/BOWL", "Zeeshan Ansari/BOWL", "Harsh Dubey/BOWL", "Gurjapneet Singh/BOWL",
    "Abhinandan Singh/BOWL", "Mohit Rathee/BOWL", "Satyanarayana Raju/BOWL", "Ashok Sharma/BOWL", "Praveen Dubey/BOWL"
  ])
];

// ---------- retired / former IPL greats ----------
const LEGENDS = [
  ...parse(200, [
    "Sachin Tendulkar/BAT", "Suresh Raina/BAT", "Yuvraj Singh/AR", "Virender Sehwag/BAT", "Gautam Gambhir/BAT",
    "Harbhajan Singh/BOWL", "Shikhar Dhawan/BAT", "Dinesh Karthik/WK",
    "AB de Villiers/BAT/SA", "Chris Gayle/BAT/WI", "Shane Warne/BOWL/AUS", "Lasith Malinga/BOWL/SL", "Dale Steyn/BOWL/SA",
    "Kieron Pollard/AR/WI", "Dwayne Bravo/AR/WI", "Shane Watson/AR/AUS", "Brendon McCullum/WK/NZ", "Adam Gilchrist/WK/AUS",
    "Matthew Hayden/BAT/AUS", "Jacques Kallis/AR/SA"
  ]),
  ...parse(150, [
    "Amit Mishra/BOWL", "Piyush Chawla/BOWL", "Ambati Rayudu/BAT", "Robin Uthappa/BAT", "Parthiv Patel/WK",
    "Murali Vijay/BAT", "Zaheer Khan/BOWL", "Ashish Nehra/BOWL", "Irfan Pathan/AR", "Yusuf Pathan/AR",
    "Rahul Dravid/BAT", "Sourav Ganguly/BAT", "VVS Laxman/BAT", "Anil Kumble/BOWL", "Wriddhiman Saha/WK",
    "Muttiah Muralitharan/BOWL/SL", "Kumar Sangakkara/WK/SL", "Mahela Jayawardene/BAT/SL", "Sanath Jayasuriya/AR/SL", "Tillakaratne Dilshan/BAT/SL",
    "Michael Hussey/BAT/AUS", "Andrew Symonds/AR/AUS", "Brett Lee/BOWL/AUS", "Ricky Ponting/BAT/AUS", "Kevin Pietersen/BAT/ENG",
    "Eoin Morgan/BAT/ENG", "Daniel Vettori/BOWL/NZ", "Morne Morkel/BOWL/SA", "Albie Morkel/AR/SA", "Mitchell Johnson/BOWL/AUS",
    "Imran Tahir/BOWL/SA", "Aaron Finch/BAT/AUS", "Chris Morris/AR/SA", "Ben Stokes/AR/ENG", "Shakib Al Hasan/AR/BAN",
    "Glenn McGrath/BOWL/AUS", "Shaun Pollock/AR/SA", "Graeme Smith/BAT/SA", "Shahid Afridi/AR/PAK", "Shoaib Akhtar/BOWL/PAK"
  ]),
  ...parse(100, [
    "Kedar Jadhav/AR", "Mandeep Singh/BAT", "Praveen Kumar/BOWL", "RP Singh/BOWL", "Munaf Patel/BOWL",
    "Pragyan Ojha/BOWL", "Vinay Kumar/BOWL", "Ashok Dinda/BOWL", "Dhawal Kulkarni/BOWL", "Manoj Tiwary/BAT",
    "Naman Ojha/WK", "Paul Valthaty/BAT", "Lakshmipathy Balaji/BOWL", "Sreesanth/BOWL", "Swapnil Asnodkar/BAT",
    "Shaun Marsh/BAT/AUS", "Dwayne Smith/BAT/WI", "Ross Taylor/BAT/NZ", "JP Duminy/AR/SA", "Mohammad Nabi/AR/AFG",
    "Jason Holder/AR/WI", "Sohail Tanvir/BOWL/PAK", "Doug Bollinger/BOWL/AUS", "Dirk Nannes/BOWL/AUS", "Lendl Simmons/BAT/WI",
    "Samuel Badree/BOWL/WI", "Darren Sammy/AR/WI", "Makhaya Ntini/BOWL/SA", "Herschelle Gibbs/BAT/SA", "Mark Boucher/WK/SA",
    "Brad Hodge/BAT/AUS", "Cameron White/BAT/AUS", "David Hussey/AR/AUS", "James Faulkner/AR/AUS", "Nathan Coulter-Nile/BOWL/AUS",
    "Ravi Bopara/AR/ENG", "Jason Roy/BAT/ENG", "Alex Hales/BAT/ENG", "Moises Henriques/AR/AUS", "Corey Anderson/AR/NZ",
    "Tim Southee/BOWL/NZ", "Martin Guptill/BAT/NZ", "Colin Munro/BAT/NZ", "Thisara Perera/AR/SL", "Angelo Mathews/AR/SL",
    "Ajantha Mendis/BOWL/SL", "Nuwan Kulasekara/BOWL/SL", "Kyle Mills/BOWL/NZ"
  ])
];

// Current players great enough for the Legends Auction.
const ICONS = [
  'Virat Kohli', 'Rohit Sharma', 'MS Dhoni', 'Jasprit Bumrah', 'Ravindra Jadeja', 'Sunil Narine', 'Andre Russell',
  'Rashid Khan', 'Yuzvendra Chahal', 'Bhuvneshwar Kumar', 'Ravichandran Ashwin', 'David Warner', 'Faf du Plessis',
  'Glenn Maxwell', 'Trent Boult', 'Ajinkya Rahane', 'KL Rahul', 'Jos Buttler', 'Suryakumar Yadav', 'Hardik Pandya',
  'Mohammed Shami', 'Kane Williamson', 'Ishant Sharma', 'Umesh Yadav', 'Mitchell Starc', 'Pat Cummins'
];

module.exports = { CURRENT, LEGENDS, ICONS };

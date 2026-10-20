// Edit freely: teams, players and auction rules all live here.
// Prices are in lakhs (100 lakhs = 1 crore).

const RULES = {
  purse: 12000,      // ₹120 cr per team
  maxSquad: 25,
  maxMembers: 10,    // people allowed in one room
  maxOverseas: 8,
  bidSeconds: 10,    // default countdown; it resets to this on every bid
  timerOptions: [5, 8, 10, 15, 20, 30], // countdowns the host can choose
  breakSeconds: 3,   // pause between lots
  xiSize: 11,        // Playing XI
  xiMaxOverseas: 4   // overseas allowed in the XI, counting the Impact Player
};

// Logos are the teams' own trademarks, loaded from Wikipedia. Swap a URL for a file in public/ if you like.
const W = 'https://thumb.wikimedia.org/wikipedia/en/thumb/';
const TEAMS = [
  { id: 'CSK',  name: 'Chennai Super Kings',         color: '#F9CD05', alt: '#0081E9',
    logo: W + '2/2b/Chennai_Super_Kings_Logo.svg/330px-Chennai_Super_Kings_Logo.svg.png' },
  { id: 'MI',   name: 'Mumbai Indians',              color: '#004BA0', alt: '#D1AB3E',
    logo: W + 'c/cd/Mumbai_Indians_Logo.svg/330px-Mumbai_Indians_Logo.svg.png' },
  { id: 'RCB',  name: 'Royal Challengers Bengaluru', color: '#EC1C24', alt: '#2B2A29',
    logo: W + 'd/d4/Royal_Challengers_Bengaluru_Logo.svg/330px-Royal_Challengers_Bengaluru_Logo.svg.png' },
  { id: 'KKR',  name: 'Kolkata Knight Riders',       color: '#3A225D', alt: '#D4AF37',
    logo: W + '4/4c/Kolkata_Knight_Riders_Logo.svg/330px-Kolkata_Knight_Riders_Logo.svg.png' },
  { id: 'SRH',  name: 'Sunrisers Hyderabad',         color: '#FF822A', alt: '#1A1A1A',
    logo: W + '5/51/Sunrisers_Hyderabad_Logo.svg/330px-Sunrisers_Hyderabad_Logo.svg.png' },
  { id: 'DC',   name: 'Delhi Capitals',              color: '#17479E', alt: '#EF1B23',
    logo: W + '2/2f/Delhi_Capitals.svg/330px-Delhi_Capitals.svg.png' },
  { id: 'RR',   name: 'Rajasthan Royals',            color: '#EA1A85', alt: '#254AA5',
    logo: W + '5/5c/This_is_the_logo_for_Rajasthan_Royals%2C_a_cricket_team_playing_in_the_Indian_Premier_League_%28IPL%29.svg/330px-This_is_the_logo_for_Rajasthan_Royals%2C_a_cricket_team_playing_in_the_Indian_Premier_League_%28IPL%29.svg.png' },
  { id: 'PBKS', name: 'Punjab Kings',                color: '#DD1F2D', alt: '#A7A9AC',
    logo: W + 'd/d4/Punjab_Kings_Logo.svg/330px-Punjab_Kings_Logo.svg.png' },
  { id: 'GT',   name: 'Gujarat Titans',              color: '#1B2133', alt: '#B1913D',
    logo: W + '0/09/Gujarat_Titans_Logo.svg/330px-Gujarat_Titans_Logo.svg.png' },
  { id: 'LSG',  name: 'Lucknow Super Giants',        color: '#00A0E3', alt: '#F28B00',
    logo: W + '3/34/Lucknow_Super_Giants_Logo.svg/330px-Lucknow_Super_Giants_Logo.svg.png' }
];

// role: BAT, BOWL, AR (all-rounder), WK (wicket-keeper)
// Photos come from photos.json (player name -> image URL, sourced from Wikipedia).
// Players missing there are looked up in the browser. To use your own picture, add or edit
// the entry in photos.json, e.g. "Virat Kohli": "/players/kohli.jpg" with the file in public/players/.
let PHOTOS = {};
try { PHOTOS = require('./photos.json'); } catch {}
const P = (name, role, country, base) => ({ name, role, country, base });
const PLAYERS = [
  // ₹2 cr base — marquee
  P('Virat Kohli','BAT','IND',200), P('Rohit Sharma','BAT','IND',200), P('Jasprit Bumrah','BOWL','IND',200),
  P('Shubman Gill','BAT','IND',200), P('Rishabh Pant','WK','IND',200), P('Suryakumar Yadav','BAT','IND',200),
  P('Hardik Pandya','AR','IND',200), P('Ravindra Jadeja','AR','IND',200), P('KL Rahul','WK','IND',200),
  P('Shreyas Iyer','BAT','IND',200), P('Yashasvi Jaiswal','BAT','IND',200), P('Mohammed Shami','BOWL','IND',200),
  P('Arshdeep Singh','BOWL','IND',200), P('Yuzvendra Chahal','BOWL','IND',200), P('Sanju Samson','WK','IND',200),
  P('Pat Cummins','BOWL','AUS',200), P('Mitchell Starc','BOWL','AUS',200), P('Travis Head','BAT','AUS',200),
  P('Jos Buttler','WK','ENG',200), P('Rashid Khan','BOWL','AFG',200), P('Heinrich Klaasen','WK','SA',200),
  P('Kagiso Rabada','BOWL','SA',200), P('Glenn Maxwell','AR','AUS',200), P('Nicholas Pooran','WK','WI',200),
  // ₹1.5 cr base
  P('Ruturaj Gaikwad','BAT','IND',150), P('Axar Patel','AR','IND',150), P('Kuldeep Yadav','BOWL','IND',150),
  P('Mohammed Siraj','BOWL','IND',150), P('Ishan Kishan','WK','IND',150), P('Abhishek Sharma','AR','IND',150),
  P('Rinku Singh','BAT','IND',150), P('Tilak Varma','BAT','IND',150), P('Varun Chakravarthy','BOWL','IND',150),
  P('Bhuvneshwar Kumar','BOWL','IND',150), P('Andre Russell','AR','WI',150), P('Sunil Narine','AR','WI',150),
  P('Trent Boult','BOWL','NZ',150), P('Liam Livingstone','AR','ENG',150), P('Phil Salt','WK','ENG',150),
  P('Jofra Archer','BOWL','ENG',150), P('David Miller','BAT','SA',150), P('Quinton de Kock','WK','SA',150),
  P('Rachin Ravindra','AR','NZ',150), P('Marcus Stoinis','AR','AUS',150),
  // ₹1 cr base
  P('MS Dhoni','WK','IND',100), P('Shivam Dube','AR','IND',100), P('Washington Sundar','AR','IND',100),
  P('Ravichandran Ashwin','BOWL','IND',100), P('Prasidh Krishna','BOWL','IND',100), P('Harshal Patel','BOWL','IND',100),
  P('Venkatesh Iyer','AR','IND',100), P('Deepak Chahar','BOWL','IND',100), P('Avesh Khan','BOWL','IND',100),
  P('Mayank Yadav','BOWL','IND',100), P('Nitish Kumar Reddy','AR','IND',100), P('Riyan Parag','AR','IND',100),
  P('Dhruv Jurel','WK','IND',100), P('Jitesh Sharma','WK','IND',100), P('Ravi Bishnoi','BOWL','IND',100),
  P('Sai Sudharsan','BAT','IND',100), P('Devdutt Padikkal','BAT','IND',100), P('Prithvi Shaw','BAT','IND',100),
  P('Jake Fraser-McGurk','BAT','AUS',100), P('Josh Hazlewood','BOWL','AUS',100), P('Mitchell Marsh','AR','AUS',100),
  P('Tim David','BAT','AUS',100), P('Sam Curran','AR','ENG',100), P('Harry Brook','BAT','ENG',100),
  P('Will Jacks','AR','ENG',100), P('Jonny Bairstow','WK','ENG',100), P('Devon Conway','WK','NZ',100),
  P('Glenn Phillips','AR','NZ',100), P('Lockie Ferguson','BOWL','NZ',100), P('Marco Jansen','AR','SA',100),
  P('Aiden Markram','BAT','SA',100), P('Tristan Stubbs','WK','SA',100), P('Anrich Nortje','BOWL','SA',100),
  P('Matheesha Pathirana','BOWL','SL',100), P('Wanindu Hasaranga','AR','SL',100), P('Noor Ahmad','BOWL','AFG',100),
  P('Rahmanullah Gurbaz','WK','AFG',100), P('Shimron Hetmyer','BAT','WI',100), P('Mustafizur Rahman','BOWL','BAN',100),
  // ₹75 L base
  P('Ajinkya Rahane','BAT','IND',75), P('Krunal Pandya','AR','IND',75), P('Shardul Thakur','AR','IND',75),
  P('Mukesh Kumar','BOWL','IND',75), P('T Natarajan','BOWL','IND',75), P('Khaleel Ahmed','BOWL','IND',75),
  P('Umran Malik','BOWL','IND',75), P('Sandeep Sharma','BOWL','IND',75), P('Rahul Tripathi','BAT','IND',75),
  P('Shashank Singh','BAT','IND',75), P('Rahul Tewatia','AR','IND',75), P('Harshit Rana','BOWL','IND',75),
  P('Mohit Sharma','BOWL','IND',75), P('Nitish Rana','BAT','IND',75), P('Maheesh Theekshana','BOWL','SL',75),
  P('Gerald Coetzee','BOWL','SA',75), P('Rovman Powell','BAT','WI',75), P('Azmatullah Omarzai','AR','AFG',75),
  P('Mitchell Santner','AR','NZ',75), P('Daryl Mitchell','AR','NZ',75), P('Kane Williamson','BAT','NZ',75),
  P('Spencer Johnson','BOWL','AUS',75), P('Nathan Ellis','BOWL','AUS',75),
  // ₹50 L base
  P('Abdul Samad','BAT','IND',50), P('Ayush Badoni','BAT','IND',50), P('Shahrukh Khan','BAT','IND',50),
  P('Naman Dhir','AR','IND',50), P('Akash Deep','BOWL','IND',50), P('Yash Dayal','BOWL','IND',50),
  P('Tushar Deshpande','BOWL','IND',50), P('Vaibhav Arora','BOWL','IND',50), P('Mohsin Khan','BOWL','IND',50),
  P('Rajat Patidar','BAT','IND',50), P('Ramandeep Singh','AR','IND',50), P('Abishek Porel','WK','IND',50),
  P('Prabhsimran Singh','WK','IND',50), P('Anuj Rawat','WK','IND',50), P('Manav Suthar','BOWL','IND',50),
  P('Romario Shepherd','AR','WI',50), P('Alzarri Joseph','BOWL','WI',50), P('Fazalhaq Farooqi','BOWL','AFG',50),
  P('Dushmantha Chameera','BOWL','SL',50), P('Rilee Rossouw','BAT','SA',50),
  // ₹30 L base — uncapped
  P('Ashutosh Sharma','BAT','IND',30), P('Angkrish Raghuvanshi','BAT','IND',30), P('Sameer Rizvi','BAT','IND',30),
  P('Nehal Wadhera','BAT','IND',30), P('Priyansh Arya','BAT','IND',30), P('Vaibhav Suryavanshi','BAT','IND',30),
  P('Suyash Sharma','BOWL','IND',30), P('Vijaykumar Vyshak','BOWL','IND',30), P('Akash Madhwal','BOWL','IND',30),
  P('Kumar Kushagra','WK','IND',30), P('Robin Minz','WK','IND',30), P('Swapnil Singh','AR','IND',30),
  P('Anshul Kamboj','AR','IND',30), P('Mukesh Choudhary','BOWL','IND',30), P('Kartik Tyagi','BOWL','IND',30),
  P('Arshin Kulkarni','AR','IND',30), P('Shams Mulani','AR','IND',30), P('Ashwani Kumar','BOWL','IND',30)
].map((p, i) => ({ id: i + 1, ...p, img: PHOTOS[p.name] || '', overseas: p.country !== 'IND' }));

module.exports = { RULES, TEAMS, PLAYERS };

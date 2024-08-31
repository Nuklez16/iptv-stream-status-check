-- phpMyAdmin SQL Dump
-- version 5.1.1
-- https://www.phpmyadmin.net/
--
-- Host: localhost
-- Generation Time: Aug 31, 2024 at 03:57 AM
-- Server version: 5.7.35-0ubuntu0.18.04.2
-- PHP Version: 8.0.10

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
START TRANSACTION;
SET time_zone = "+00:00";


/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;

--
-- Database: `iptv_test`
--
CREATE DATABASE IF NOT EXISTS `iptv_test` DEFAULT CHARACTER SET latin1 COLLATE latin1_swedish_ci;
USE `iptv_test`;

-- --------------------------------------------------------

--
-- Table structure for table `streams`
--

CREATE TABLE `streams` (
  `id` int(11) NOT NULL,
  `name` varchar(255) DEFAULT NULL,
  `url` varchar(255) DEFAULT NULL,
  `status` enum('online','offline') DEFAULT NULL,
  `last_checked` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `tvg_id` varchar(50) DEFAULT NULL,
  `tvg_chno` int(11) DEFAULT NULL,
  `tvg_logo` varchar(255) DEFAULT NULL,
  `tvg_name` varchar(255) DEFAULT NULL
) ENGINE=MyISAM DEFAULT CHARSET=latin1;

--
-- Dumping data for table `streams`
--

INSERT INTO `streams` (`id`, `name`, `url`, `status`, `last_checked`, `tvg_id`, `tvg_chno`, `tvg_logo`, `tvg_name`) VALUES
(8, 'Optus 01', '', 'offline', '2024-08-31 02:57:28', 'os1', 8, '', 'Optus 01'),
(27, 'CNBC (US)', '', 'online', '2024-08-31 02:57:26', 'CNBC.us', 26, NULL, 'CNBC (US)');

--
-- Indexes for dumped tables
--

--
-- Indexes for table `streams`
--
ALTER TABLE `streams`
  ADD PRIMARY KEY (`id`);

--
-- AUTO_INCREMENT for dumped tables
--

--
-- AUTO_INCREMENT for table `streams`
--
ALTER TABLE `streams`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=29;
COMMIT;

/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
